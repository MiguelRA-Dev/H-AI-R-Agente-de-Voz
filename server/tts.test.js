import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { ttsDisponible, sintetizarVoz } from "./tts.js";

const ENV_ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
  jest.restoreAllMocks();
  delete global.fetch;
});

describe("ttsDisponible", () => {
  test("false si falta la API key o la región", () => {
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
    expect(ttsDisponible()).toBe(false);

    process.env.AZURE_SPEECH_KEY = "clave-de-prueba";
    delete process.env.AZURE_SPEECH_REGION;
    expect(ttsDisponible()).toBe(false);
  });

  test("true si ambas variables están presentes", () => {
    process.env.AZURE_SPEECH_KEY = "clave-de-prueba";
    process.env.AZURE_SPEECH_REGION = "eastus";
    expect(ttsDisponible()).toBe(true);
  });
});

describe("sintetizarVoz", () => {
  beforeEach(() => {
    process.env.AZURE_SPEECH_KEY = "clave-de-prueba";
    process.env.AZURE_SPEECH_REGION = "eastus";
  });

  test("llama al endpoint de la región configurada con los headers y el SSML esperados", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    await sintetizarVoz("Hola, bienvenido a la entrevista.");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(opciones.method).toBe("POST");
    expect(opciones.headers["Ocp-Apim-Subscription-Key"]).toBe("clave-de-prueba");
    expect(opciones.headers["Content-Type"]).toBe("application/ssml+xml");
    expect(opciones.headers["X-Microsoft-OutputFormat"]).toBeTruthy();

    expect(opciones.body).toContain("Hola, bienvenido a la entrevista.");
    expect(opciones.body).toContain("<speak");
    expect(opciones.body).toContain("es-MX");
  });

  test("usa un estilo de habla expresivo en inglés (Andrew sí lo soporta)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await sintetizarVoz("Tell me a bit about yourself.", "en");

    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.body).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(opciones.body).toContain("<mstts:express-as");
    expect(opciones.body).toContain('style="empathetic"');
  });

  test("en español no manda express-as — Ava no soporta ningún estilo", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await sintetizarVoz("Cuéntame un poco sobre ti.", "es");

    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.body).not.toContain("<mstts:express-as");
  });

  test("inserta una pausa después de cada fin de oración, nunca al final del texto", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await sintetizarVoz("Qué bueno saludarte. Empecemos con la primera pregunta.");

    const [, opciones] = global.fetch.mock.calls[0];
    // Una sola pausa: entre las dos oraciones, no una colgando al final
    // (el texto tiene 2 oraciones pero solo 1 punto seguido de espacio).
    expect(opciones.body.match(/<break time="320ms"\/>/g)).toHaveLength(1);
    expect(opciones.body).toContain('saludarte.<break time="320ms"/> Empecemos');
  });

  test("escapa caracteres reservados de XML en el texto", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await sintetizarVoz(`Tom & Jerry's "aventura" <especial>`);

    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.body).toContain("Tom &amp; Jerry&apos;s &quot;aventura&quot; &lt;especial&gt;");
  });

  test("devuelve los bytes de audio y content-type audio/mpeg", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    });

    const resultado = await sintetizarVoz("texto");
    expect(resultado.contentType).toBe("audio/mpeg");
    expect(Buffer.isBuffer(resultado.audio)).toBe(true);
    expect([...resultado.audio]).toEqual([9, 9, 9]);
  });

  test("con idioma 'en' usa la voz y el locale en inglés, no el de español", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await sintetizarVoz("Hello, welcome to the interview.", "en");

    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.body).toContain("en-US");
    expect(opciones.body).not.toContain("es-CO");
  });

  test("lanza un error legible si Azure Speech responde con un status de error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key inválida",
    });

    await expect(sintetizarVoz("texto")).rejects.toThrow(/401/);
  });
});
