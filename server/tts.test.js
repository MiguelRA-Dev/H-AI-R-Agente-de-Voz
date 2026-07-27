import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { ttsDisponible, sintetizarVoz } from "./tts.js";

const ENV_ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
  jest.restoreAllMocks();
  delete global.fetch;
});

describe("ttsDisponible", () => {
  test("false si falta la API key o el voice id", () => {
    delete process.env.CARTESIA_API_KEY;
    delete process.env.CARTESIA_VOICE_ID;
    expect(ttsDisponible()).toBe(false);

    process.env.CARTESIA_API_KEY = "sk_car_test";
    delete process.env.CARTESIA_VOICE_ID;
    expect(ttsDisponible()).toBe(false);
  });

  test("true si ambas variables están presentes", () => {
    process.env.CARTESIA_API_KEY = "sk_car_test";
    process.env.CARTESIA_VOICE_ID = "voice-de-prueba";
    expect(ttsDisponible()).toBe(true);
  });
});

describe("sintetizarVoz", () => {
  beforeEach(() => {
    process.env.CARTESIA_API_KEY = "sk_car_test";
    process.env.CARTESIA_VOICE_ID = "voice-de-prueba";
  });

  test("llama al endpoint correcto con los headers y el body esperados", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => "audio/mpeg" },
    });

    await sintetizarVoz("Hola, bienvenido a la entrevista.");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(opciones.method).toBe("POST");
    expect(opciones.headers.Authorization).toBe("Bearer sk_car_test");
    expect(opciones.headers["Cartesia-Version"]).toBeTruthy();

    const body = JSON.parse(opciones.body);
    expect(body.transcript).toBe("Hola, bienvenido a la entrevista.");
    expect(body.voice).toEqual({ mode: "id", id: "voice-de-prueba" });
    expect(body.language).toBe("es");
  });

  test("devuelve los bytes de audio y el content-type de la respuesta", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
      headers: { get: () => "audio/mpeg" },
    });

    const resultado = await sintetizarVoz("texto");
    expect(resultado.contentType).toBe("audio/mpeg");
    expect(Buffer.isBuffer(resultado.audio)).toBe(true);
    expect([...resultado.audio]).toEqual([9, 9, 9]);
  });

  test("lanza un error legible si Cartesia responde con un status de error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key inválida",
    });

    await expect(sintetizarVoz("texto")).rejects.toThrow(/401/);
  });
});
