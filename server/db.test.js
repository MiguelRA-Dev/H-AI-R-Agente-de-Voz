import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const insertOneMock = jest.fn();
const findOneMock = jest.fn();
const toArrayMock = jest.fn();
const sortMock = jest.fn(() => ({ toArray: toArrayMock }));
const findMock = jest.fn(() => ({ sort: sortMock }));
const connectMock = jest.fn();
const collectionMock = jest.fn(() => ({
  insertOne: insertOneMock,
  find: findMock,
  findOne: findOneMock,
}));
const dbMock = jest.fn(() => ({ collection: collectionMock }));

// Doble simple de ObjectId: solo necesitamos toString() e isValid() para
// probar el mapeo _id -> id sin depender del driver real de Mongo.
class ObjectIdMock {
  constructor(id) {
    this.id = id;
  }
  toString() {
    return this.id;
  }
  static isValid(id) {
    return typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
  }
}

jest.unstable_mockModule("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: connectMock,
  })),
  ObjectId: ObjectIdMock,
}));

let guardarEntrevista;
let obtenerVacantesPublicadas;
let obtenerVacantePorId;

beforeEach(async () => {
  jest.resetModules();
  process.env.MONGODB_URI = "mongodb://usuario:clave@fake-host-de-prueba/?retryWrites=true";

  insertOneMock.mockReset().mockResolvedValue({ insertedId: "id-de-prueba" });
  findOneMock.mockReset();
  toArrayMock.mockReset();
  sortMock.mockClear();
  findMock.mockClear();
  connectMock.mockReset().mockResolvedValue({ db: dbMock });
  dbMock.mockClear();
  collectionMock.mockClear();

  ({ guardarEntrevista, obtenerVacantesPublicadas, obtenerVacantePorId } = await import("./db.js"));
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

  test("convierte vacanteId (string) a ObjectId antes de guardar", async () => {
    await guardarEntrevista({ vacante: "QA Tester", vacanteId: "507f1f77bcf86cd799439011" });

    const documentoGuardado = insertOneMock.mock.calls[0][0];
    expect(documentoGuardado.vacanteId).toBeInstanceOf(ObjectIdMock);
    expect(documentoGuardado.vacanteId.toString()).toBe("507f1f77bcf86cd799439011");
  });

  test("no agrega vacanteId si no viene en el registro", async () => {
    await guardarEntrevista({ vacante: "QA Tester" });

    const documentoGuardado = insertOneMock.mock.calls[0][0];
    expect(documentoGuardado.vacanteId).toBeUndefined();
  });
});

describe("obtenerVacantesPublicadas", () => {
  test("consulta la colección 'vacantes' filtrando por estado 'abierta'", async () => {
    toArrayMock.mockResolvedValue([]);
    await obtenerVacantesPublicadas();

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("vacantes");
    expect(findMock).toHaveBeenCalledWith({ estado: "abierta" }, expect.any(Object));
  });

  test("mapea _id a id (string) y conserva el resto de los campos", async () => {
    toArrayMock.mockResolvedValue([
      { _id: new ObjectIdMock("abc123"), titulo: "Ingeniero de Sistemas", ubicacion: "Bogota" },
    ]);

    const vacantes = await obtenerVacantesPublicadas();

    expect(vacantes).toEqual([
      { id: "abc123", titulo: "Ingeniero de Sistemas", ubicacion: "Bogota" },
    ]);
  });
});

describe("obtenerVacantePorId", () => {
  test("devuelve null si el id no es un ObjectId válido, sin llegar a consultar Mongo", async () => {
    const vacante = await obtenerVacantePorId("no-es-un-id-valido");

    expect(vacante).toBeNull();
    expect(findOneMock).not.toHaveBeenCalled();
  });

  test("devuelve null si no encuentra una vacante abierta con ese id", async () => {
    findOneMock.mockResolvedValue(null);

    const vacante = await obtenerVacantePorId("507f1f77bcf86cd799439011");
    expect(vacante).toBeNull();
  });

  test("devuelve la vacante con id (string) en vez de _id", async () => {
    findOneMock.mockResolvedValue({
      _id: new ObjectIdMock("507f1f77bcf86cd799439011"),
      titulo: "Ingeniero de Sistemas",
      requisitos: "2 años de experiencia",
    });

    const vacante = await obtenerVacantePorId("507f1f77bcf86cd799439011");

    expect(vacante).toEqual({
      id: "507f1f77bcf86cd799439011",
      titulo: "Ingeniero de Sistemas",
      requisitos: "2 años de experiencia",
    });
  });
});
