import { MongoClient, ObjectId } from "mongodb";

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    if (!process.env.MONGODB_URI) {
      throw new Error("Falta MONGODB_URI en server/.env");
    }
    const client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect();
  }
  return clientPromise;
}

// Guarda un registro de entrevista y devuelve el _id insertado. Si viene
// vacanteId (string), se guarda como ObjectId real: es el mismo tipo que usa
// el dashboard de RRHH cuando vincula una entrevista a mano, así el vínculo
// automático y el manual son indistinguibles para sus filtros/stats.
export async function guardarEntrevista(registro) {
  const client = await getClient();
  const db = client.db("agente_voz");
  const coleccion = db.collection("entrevistas");
  const documento = { ...registro, creadoEn: new Date() };
  if (documento.vacanteId) {
    documento.vacanteId = new ObjectId(documento.vacanteId);
  }
  const resultado = await coleccion.insertOne(documento);
  return resultado.insertedId;
}

// Campos que necesita la tarjeta de selección en el cliente. Incluye
// requisitos porque la tarjeta seleccionada los muestra completos.
const PROYECCION_TARJETA = {
  titulo: 1,
  descripcion: 1,
  departamento: 1,
  ubicacion: 1,
  modalidad: 1,
  tipoContrato: 1,
  requisitos: 1,
};

// Lista las vacantes que RRHH dejó publicadas (dashboard del otro
// microservicio, colección compartida "vacantes" en esta misma base).
export async function obtenerVacantesPublicadas() {
  const client = await getClient();
  const db = client.db("agente_voz");
  const vacantes = await db
    .collection("vacantes")
    .find({ estado: "abierta" }, { projection: PROYECCION_TARJETA })
    .sort({ creadoEn: -1 })
    .toArray();

  return vacantes.map(({ _id, ...resto }) => ({ id: _id.toString(), ...resto }));
}

// Trae el documento completo de una vacante publicada para armar el plan de
// entrevista y el systemInstruction del chat.
export async function obtenerVacantePorId(id) {
  if (!ObjectId.isValid(id)) return null;

  const client = await getClient();
  const db = client.db("agente_voz");
  const vacante = await db
    .collection("vacantes")
    .findOne({ _id: new ObjectId(id), estado: "abierta" });

  if (!vacante) return null;
  const { _id, ...resto } = vacante;
  return { id: _id.toString(), ...resto };
}
