import { MongoClient } from "mongodb";

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

// Guarda un registro de entrevista y devuelve el _id insertado.
export async function guardarEntrevista(registro) {
  const client = await getClient();
  const db = client.db("agente_voz");
  const coleccion = db.collection("entrevistas");
  const resultado = await coleccion.insertOne({ ...registro, creadoEn: new Date() });
  return resultado.insertedId;
}
