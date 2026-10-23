import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const insertOneMock = jest.fn();
const findOneMock = jest.fn();
const toArrayMock = jest.fn();
const sortMock = jest.fn(() => ({ toArray: toArrayMock }));
const findMock = jest.fn(() => ({ sort: sortMock }));
const updateOneMock = jest.fn();
const deleteOneMock = jest.fn();
const createIndexMock = jest.fn();
const connectMock = jest.fn();
const collectionMock = jest.fn(() => ({
  insertOne: insertOneMock,
  find: findMock,
  findOne: findOneMock,
  updateOne: updateOneMock,
  deleteOne: deleteOneMock,
  createIndex: createIndexMock,
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
let obtenerOrganizacionPorSlug;
let obtenerVacantesPublicadas;
let obtenerVacantePorId;
let guardarSesion;
let obtenerSesion;
let eliminarSesion;
let asegurarIndiceSesiones;
let registrarUsoTts;
let obtenerUsoTts;

beforeEach(async () => {
  jest.resetModules();
  process.env.MONGODB_URI = "mongodb://usuario:clave@fake-host-de-prueba/?retryWrites=true";

  insertOneMock.mockReset().mockResolvedValue({ insertedId: "id-de-prueba" });
  findOneMock.mockReset();
  toArrayMock.mockReset();
  sortMock.mockClear();
  findMock.mockClear();
  updateOneMock.mockReset();
  deleteOneMock.mockReset();
  createIndexMock.mockReset();
  connectMock.mockReset().mockResolvedValue({ db: dbMock });
  dbMock.mockClear();
  collectionMock.mockClear();

  ({
    guardarEntrevista,
    obtenerOrganizacionPorSlug,
    obtenerVacantesPublicadas,
    obtenerVacantePorId,
    guardarSesion,
    obtenerSesion,
    eliminarSesion,
    asegurarIndiceSesiones,
    registrarUsoTts,
    obtenerUsoTts,
  } = await import("./db.js"));
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

  test("convierte organizacionId (string) a ObjectId antes de guardar", async () => {
    await guardarEntrevista({ vacante: "QA Tester", organizacionId: "507f1f77bcf86cd799439011" });

    const documentoGuardado = insertOneMock.mock.calls[0][0];
    expect(documentoGuardado.organizacionId).toBeInstanceOf(ObjectIdMock);
    expect(documentoGuardado.organizacionId.toString()).toBe("507f1f77bcf86cd799439011");
  });
});

describe("obtenerOrganizacionPorSlug", () => {
  test("busca por slug en la colección 'organizaciones'", async () => {
    findOneMock.mockResolvedValue(null);
    await obtenerOrganizacionPorSlug("ingeurbe");

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("organizaciones");
    expect(findOneMock).toHaveBeenCalledWith({ slug: "ingeurbe" });
  });

  test("devuelve null si no existe una organización con ese slug", async () => {
    findOneMock.mockResolvedValue(null);
    const organizacion = await obtenerOrganizacionPorSlug("no-existe");
    expect(organizacion).toBeNull();
  });

  test("mapea _id a id (string) y conserva el resto de los campos", async () => {
    findOneMock.mockResolvedValue({
      _id: new ObjectIdMock("abc123"),
      nombre: "Ingeurbe",
      slug: "ingeurbe",
      licencias: { admin: 1, reclutador: 3 },
    });

    const organizacion = await obtenerOrganizacionPorSlug("ingeurbe");

    expect(organizacion).toEqual({
      id: "abc123",
      nombre: "Ingeurbe",
      slug: "ingeurbe",
      licencias: { admin: 1, reclutador: 3 },
    });
  });
});

describe("obtenerVacantesPublicadas", () => {
  test("consulta la colección 'vacantes' filtrando por estado 'abierta' y la organización", async () => {
    toArrayMock.mockResolvedValue([]);
    await obtenerVacantesPublicadas("507f1f77bcf86cd799439011");

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("vacantes");
    const filtro = findMock.mock.calls[0][0];
    expect(filtro.estado).toBe("abierta");
    expect(filtro.organizacionId).toBeInstanceOf(ObjectIdMock);
    expect(filtro.organizacionId.toString()).toBe("507f1f77bcf86cd799439011");
  });

  test("mapea _id a id (string) y conserva el resto de los campos", async () => {
    toArrayMock.mockResolvedValue([
      { _id: new ObjectIdMock("abc123"), titulo: "Ingeniero de Sistemas", ubicacion: "Bogota" },
    ]);

    const vacantes = await obtenerVacantesPublicadas("507f1f77bcf86cd799439011");

    expect(vacantes).toEqual([
      { id: "abc123", titulo: "Ingeniero de Sistemas", ubicacion: "Bogota" },
    ]);
  });
});

describe("obtenerVacantePorId", () => {
  const ORG_ID = "507f1f77bcf86cd799439011";

  test("devuelve null si el id no es un ObjectId válido, sin llegar a consultar Mongo", async () => {
    const vacante = await obtenerVacantePorId("no-es-un-id-valido", ORG_ID);

    expect(vacante).toBeNull();
    expect(findOneMock).not.toHaveBeenCalled();
  });

  test("devuelve null si organizacionId no es un ObjectId válido, sin llegar a consultar Mongo", async () => {
    const vacante = await obtenerVacantePorId(ORG_ID, "no-es-un-id-valido");

    expect(vacante).toBeNull();
    expect(findOneMock).not.toHaveBeenCalled();
  });

  test("devuelve null si no encuentra una vacante abierta de esa organización con ese id", async () => {
    findOneMock.mockResolvedValue(null);

    const vacante = await obtenerVacantePorId(ORG_ID, ORG_ID);
    expect(vacante).toBeNull();
  });

  test("filtra también por organizacionId, no solo por _id y estado", async () => {
    findOneMock.mockResolvedValue(null);
    await obtenerVacantePorId(ORG_ID, ORG_ID);

    const filtro = findOneMock.mock.calls[0][0];
    expect(filtro.organizacionId).toBeInstanceOf(ObjectIdMock);
    expect(filtro.organizacionId.toString()).toBe(ORG_ID);
  });

  test("devuelve la vacante con id (string) en vez de _id", async () => {
    findOneMock.mockResolvedValue({
      _id: new ObjectIdMock("507f1f77bcf86cd799439011"),
      titulo: "Ingeniero de Sistemas",
      requisitos: "2 años de experiencia",
    });

    const vacante = await obtenerVacantePorId("507f1f77bcf86cd799439011", ORG_ID);

    expect(vacante).toEqual({
      id: "507f1f77bcf86cd799439011",
      titulo: "Ingeniero de Sistemas",
      requisitos: "2 años de experiencia",
    });
  });
});

describe("guardarSesion", () => {
  test("hace upsert en 'sesiones_activas' usando el sessionId como _id", async () => {
    await guardarSesion("sesion-1", { turnos: 2 });

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("sesiones_activas");
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: "sesion-1" },
      { $set: expect.objectContaining({ turnos: 2, actualizadoEn: expect.any(Date) }) },
      { upsert: true }
    );
  });
});

describe("obtenerSesion", () => {
  test("busca por _id en 'sesiones_activas'", async () => {
    findOneMock.mockResolvedValue({ _id: "sesion-1", turnos: 3 });

    const sesion = await obtenerSesion("sesion-1");

    expect(collectionMock).toHaveBeenCalledWith("sesiones_activas");
    expect(findOneMock).toHaveBeenCalledWith({ _id: "sesion-1" });
    expect(sesion).toEqual({ _id: "sesion-1", turnos: 3 });
  });

  test("devuelve null si no existe (nunca existió, terminó, o expiró por TTL)", async () => {
    findOneMock.mockResolvedValue(null);
    const sesion = await obtenerSesion("no-existe");
    expect(sesion).toBeNull();
  });
});

describe("eliminarSesion", () => {
  test("borra por _id en 'sesiones_activas'", async () => {
    await eliminarSesion("sesion-1");

    expect(collectionMock).toHaveBeenCalledWith("sesiones_activas");
    expect(deleteOneMock).toHaveBeenCalledWith({ _id: "sesion-1" });
  });
});

describe("asegurarIndiceSesiones", () => {
  test("crea el índice TTL sobre 'actualizadoEn'", async () => {
    await asegurarIndiceSesiones();

    expect(collectionMock).toHaveBeenCalledWith("sesiones_activas");
    expect(createIndexMock).toHaveBeenCalledWith(
      { actualizadoEn: 1 },
      { expireAfterSeconds: expect.any(Number) }
    );
  });
});

describe("registrarUsoTts", () => {
  test("suma caracteres y peticiones al documento del mes en curso", async () => {
    await registrarUsoTts(42);

    expect(dbMock).toHaveBeenCalledWith("agente_voz");
    expect(collectionMock).toHaveBeenCalledWith("uso_tts");
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: expect.stringMatching(/^\d{4}-\d{2}$/) },
      {
        $inc: { caracteres: 42, peticiones: 1 },
        $set: { actualizadoEn: expect.any(Date) },
      },
      { upsert: true }
    );
  });
});

describe("obtenerUsoTts", () => {
  test("devuelve el consumo del mes en curso", async () => {
    findOneMock.mockResolvedValue({ caracteres: 1500, peticiones: 12 });

    const uso = await obtenerUsoTts();

    expect(collectionMock).toHaveBeenCalledWith("uso_tts");
    expect(uso.mes).toMatch(/^\d{4}-\d{2}$/);
    expect(uso.caracteres).toBe(1500);
    expect(uso.peticiones).toBe(12);
  });

  test("devuelve 0 si todavía no se sintetizó nada este mes", async () => {
    findOneMock.mockResolvedValue(null);

    const uso = await obtenerUsoTts();

    expect(uso.caracteres).toBe(0);
    expect(uso.peticiones).toBe(0);
  });
});
