import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const insertOneMock = jest.fn();
const connectMock = jest.fn();
const collectionMock = jest.fn(() => ({ insertOne: insertOneMock }));
const dbMock = jest.fn(() => ({ collection: collectionMock }));

jest.unstable_mockModule("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: connectMock,
  })),
}));

let guardarEntrevista;

beforeEach(async () => {
  jest.resetModules();
  process.env.MONGODB_URI = "mongodb://usuario:clave@fake-host-de-prueba/?retryWrites=true";

  insertOneMock.mockReset().mockResolvedValue({ insertedId: "id-de-prueba" });
  connectMock.mockReset().mockResolvedValue({ db: dbMock });
  dbMock.mockClear();
  collectionMock.mockClear();

  ({ guardarEntrevista } = await import("./db.js"));
});

describe("guardarEntrevista", () => {
  test("usa la base 'agente_voz' y la colección 'entrevistas'", async () => {
    await guardarEntrevista({ vacante: "QA Tester", candidato: "Ana" });

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("entrevistas");
  });

  test("agrega creadoEn sin perder los campos del registro original", async () => {
    const registro = { vacante: "QA Tester", candidato: "Ana", aprobado: true };
    await guardarEntrevista(registro);

    expect(insertOneMock).toHaveBeenCalledTimes(1);
    const documentoGuardado = insertOneMock.mock.calls[0][0];
    expect(documentoGuardado).toMatchObject(registro);
    expect(documentoGuardado.creadoEn).toBeInstanceOf(Date);
  });

  test("devuelve el insertedId que entrega Mongo", async () => {
    const id = await guardarEntrevista({ vacante: "QA Tester" });
    expect(id).toBe("id-de-prueba");
  });

  test("reutiliza la misma conexión entre llamadas (no reconecta cada vez)", async () => {
    await guardarEntrevista({ vacante: "QA Tester" });
    await guardarEntrevista({ vacante: "QA Tester" });

    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
