import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  MARCA_FIN,
  generarPlanEntrevista,
  crearChatEntrevista,
  evaluarEntrevista,
} from "./gemini.js";
import {
  guardarEntrevista,
  obtenerVacantesPublicadas,
  obtenerVacantePorId,
  guardarSesion,
  obtenerSesion,
  eliminarSesion,
  asegurarIndiceSesiones,
} from "./db.js";
import { debeForzarCierre, construirMensajeConNota, extraerCierre } from "./entrevistaLogica.js";
import { ttsDisponible, sintetizarVoz } from "./tts.js";

dotenv.config();

console.log("API KEY cargada:", !!process.env.GEMINI_API_KEY);
console.log(
  "Prefijo:",
  process.env.GEMINI_API_KEY?.substring(0, 6)
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "❌ Falta GEMINI_API_KEY. Copia server/.env.example a server/.env y agrega tu API key gratuita de https://aistudio.google.com"
  );
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error(
    "❌ Falta MONGODB_URI. Sin esto no se pueden cargar las vacantes publicadas por RRHH ni " +
      "guardar los resultados de la entrevista."
  );
  process.exit(1);
}
if (!ttsDisponible()) {
  console.warn(
    "⚠️  Falta CARTESIA_API_KEY o CARTESIA_VOICE_ID en server/.env — la voz cae de vuelta al " +
      "TTS del navegador."
  );
}
const app = express();
app.use(express.json());

// En producción (después de `npm run build` en /client) esto sirve la app de
// React ya compilada. En desarrollo Vite corre aparte y le hace proxy a /api.
app.use(express.static(path.join(__dirname, "../client/dist")));

// Caché en memoria de sesiones activas — evita ir a Mongo en cada turno.
// La fuente de verdad es la colección "sesiones_activas" (ver db.js): si el
// servidor se reinicia a mitad de una entrevista, este Map queda vacío pero
// la sesión sigue en Mongo, y `obtenerSesionActiva` la reconstruye sola en
// la siguiente petición (rehidratación perezosa).
// sessionId -> { vacante, vacanteId, vacanteInfo, chat, plan, mensajes, turnos, finalizada, avisoPrivacidadAceptadoEn }
const sessions = new Map();

const MENSAJE_ARRANQUE =
  "Ya puedes iniciar la entrevista: da la bienvenida al candidato siguiendo el paso 1 de tus instrucciones.";

const MENSAJE_CIERRE_FORZADO =
  "Gracias por tu tiempo y por tus respuestas. Con esto damos por terminada la entrevista.";

// El objeto "chat" del SDK de Gemini no es serializable: esto es lo único
// que realmente se guarda en Mongo en cada turno.
function sesionPersistible(session) {
  const { chat, ...resto } = session;
  return resto;
}

// Reconstruye el historial en el formato que espera `chats.create()`:
// alternando 'user'/'model' y empezando en 'user'. MENSAJE_ARRANQUE fue el
// primer turno real (nunca se guarda en `mensajes`, solo la apertura que
// generó), así que hay que anteponerlo para que la reconstrucción sea fiel.
function construirHistorialGemini(mensajes) {
  return [
    { role: "user", parts: [{ text: MENSAJE_ARRANQUE }] },
    ...mensajes.map((m) => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
  ];
}

// Devuelve la sesión activa: primero del caché en memoria, y si no está
// (típicamente porque el servidor se reinició) la recupera de Mongo y
// reconstruye el chat de Gemini con su historial real antes de devolverla.
async function obtenerSesionActiva(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const guardada = await obtenerSesion(sessionId);
  if (!guardada) return null;

  const chat = crearChatEntrevista(
    guardada.vacanteInfo,
    guardada.plan,
    construirHistorialGemini(guardada.mensajes)
  );

  const session = { ...guardada, chat };
  delete session._id;
  delete session.actualizadoEn;

  sessions.set(sessionId, session);
  console.log(`↻ Sesión ${sessionId} reconstruida desde Mongo (el servidor se reinició).`);
  return session;
}

// Lista las vacantes que RRHH dejó publicadas en su dashboard, para que el
// candidato elija una en vez de escribir el puesto a mano.
app.get("/api/vacantes", async (req, res) => {
  try {
    const vacantes = await obtenerVacantesPublicadas();
    res.json({ vacantes });
  } catch (err) {
    console.error("Error obteniendo las vacantes publicadas:", err);
    res
      .status(500)
      .json({ error: "No se pudieron cargar las vacantes. Revisa la consola del servidor." });
  }
});

// Crea la sesión: busca la vacante elegida, genera el plan de preguntas a partir
// de su descripción/requisitos reales, arma el chat con el entrevistador ya
// perfilado, y hace que la IA abra la conversación ella misma.
app.post("/api/session", async (req, res) => {
  const vacanteId = (req.body?.vacanteId || "").trim();
  if (!vacanteId) {
    return res.status(400).json({ error: "Falta seleccionar una vacante." });
  }
  // Exigido también del lado del servidor (no solo deshabilitando el botón en
  // el cliente): sin esto no hay consentimiento válido para tratar cédula,
  // celular y la grabación de la entrevista (Ley 1581 de 2012, Colombia).
  if (req.body?.aceptaAvisoPrivacidad !== true) {
    return res
      .status(400)
      .json({ error: "Debes aceptar el aviso de tratamiento de datos personales para continuar." });
  }

  try {
    const vacante = await obtenerVacantePorId(vacanteId);
    if (!vacante) {
      return res.status(404).json({ error: "La vacante seleccionada ya no está disponible." });
    }

    const plan = await generarPlanEntrevista(vacante);
    const chat = crearChatEntrevista(vacante, plan);
    const apertura = await chat.sendMessage({ message: MENSAJE_ARRANQUE });

    const sessionId = randomUUID();
    const session = {
      vacante: vacante.titulo,
      vacanteId: vacante.id,
      vacanteInfo: vacante,
      chat,
      plan,
      mensajes: [{ role: "ai", text: apertura.text }],
      turnos: 0,
      finalizada: false,
      avisoPrivacidadAceptadoEn: new Date(),
    };
    sessions.set(sessionId, session);
    await guardarSesion(sessionId, sesionPersistible(session));

    res.json({
      sessionId,
      openingText: apertura.text,
      vacante: vacante.titulo,
      totalPreguntas: plan.totalPreguntas,
    });
  } catch (err) {
    console.error("Error creando la sesión de entrevista:", err);
    res
      .status(500)
      .json({ error: "No se pudo iniciar la entrevista. Revisa la consola del servidor." });
  }
});

// Envía la respuesta hablada (ya transcrita) del candidato y devuelve la siguiente
// pregunta o, si el modelo decidió cerrar, el mensaje de despedida.
app.post("/api/message", async (req, res) => {
  const { sessionId, message } = req.body || {};

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Mensaje vacío." });
  }

  let session;
  try {
    session = await obtenerSesionActiva(sessionId);
  } catch (err) {
    console.error("Error recuperando la sesión:", err);
    return res
      .status(500)
      .json({ error: "No se pudo recuperar la sesión. Revisa la consola del servidor." });
  }
  if (!session) {
    return res.status(404).json({ error: "Sesión no encontrada. Inicia una nueva entrevista." });
  }
  if (session.finalizada) {
    return res.status(400).json({ error: "Esta entrevista ya finalizó." });
  }

  // El turno del candidato solo se confirma (mensajes + contador) si el modelo
  // llega a responder con éxito. Así, si Gemini falla (ej. 503 por demanda) y el
  // cliente reintenta con el mismo mensaje, no queda duplicado ni el contador se
  // adelanta de más.
  const turnoSiguiente = session.turnos + 1;

  // Ya se hicieron todas las preguntas planeadas (barra de progreso al 100%) y el
  // modelo no cerró solo dentro del margen de seguridad: cerramos nosotros sin
  // volver a llamar al modelo, para no arriesgarnos a que mande una pregunta más.
  if (debeForzarCierre(turnoSiguiente, session.plan.totalPreguntas)) {
    session.mensajes.push({ role: "user", text: message });
    session.mensajes.push({ role: "ai", text: MENSAJE_CIERRE_FORZADO });
    session.turnos = turnoSiguiente;
    session.finalizada = true;
    res.json({
      text: MENSAJE_CIERRE_FORZADO,
      finalizada: true,
      progreso: { actual: session.turnos, total: session.plan.totalPreguntas },
    });
    guardarSesion(sessionId, sesionPersistible(session)).catch((err) =>
      console.error("Error guardando la sesión en Mongo:", err)
    );
    finalizarYGuardar(sessionId, session).catch((err) =>
      console.error("Error evaluando/guardando la entrevista:", err)
    );
    return;
  }

  const mensajeAEnviar = construirMensajeConNota(message, turnoSiguiente, session.plan.totalPreguntas);

  try {
    const respuesta = await session.chat.sendMessage({ message: mensajeAEnviar });
    const { texto, finalizada } = extraerCierre(respuesta.text, MARCA_FIN);

    if (finalizada) {
      session.finalizada = true;
    }

    session.mensajes.push({ role: "user", text: message });
    session.mensajes.push({ role: "ai", text: texto });
    session.turnos = turnoSiguiente;

    res.json({
      text: texto,
      finalizada,
      progreso: { actual: session.turnos, total: session.plan.totalPreguntas },
    });

    guardarSesion(sessionId, sesionPersistible(session)).catch((err) =>
      console.error("Error guardando la sesión en Mongo:", err)
    );

    if (finalizada) {
      finalizarYGuardar(sessionId, session).catch((err) =>
        console.error("Error evaluando/guardando la entrevista:", err)
      );
    }
  } catch (err) {
    console.error("Error llamando a Gemini:", err);
    res
      .status(500)
      .json({ error: "No se pudo generar una respuesta. Revisa la consola del servidor." });
  }
});

// Convierte el texto del entrevistador a voz natural. El cliente cae de vuelta
// al TTS del navegador si esto falla o si no hay credenciales de Cartesia.
app.post("/api/tts", async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Falta el texto a sintetizar." });
  }
  if (!ttsDisponible()) {
    return res.status(503).json({ error: "TTS de Cartesia no está configurado." });
  }

  try {
    const { audio, contentType } = await sintetizarVoz(text);
    res.set("Content-Type", contentType);
    res.send(audio);
  } catch (err) {
    console.error("Error generando audio con Cartesia:", err);
    res.status(500).json({ error: "No se pudo generar el audio." });
  }
});

// Evalúa la entrevista completa y la guarda en MongoDB. Corre en segundo plano
// (no bloquea la respuesta al candidato) para que el cierre se sienta inmediato.
// Al terminar, limpia la sesión en curso (caché y Mongo): ya quedó capturada
// para siempre en "entrevistas", no hace falta seguir guardándola aparte.
async function finalizarYGuardar(sessionId, session) {
  const evaluacion = await evaluarEntrevista(session.vacante, session.mensajes);
  const id = await guardarEntrevista({
    vacante: session.vacante,
    vacanteId: session.vacanteId,
    candidato: evaluacion.nombreCandidato,
    cedula: evaluacion.cedulaCandidato,
    celular: evaluacion.celularCandidato,
    avisoPrivacidadAceptadoEn: session.avisoPrivacidadAceptadoEn,
    transcripcion: session.mensajes,
    aprobado: evaluacion.aprobado,
    puntaje: evaluacion.puntaje,
    resumen: evaluacion.resumen,
    fortalezas: evaluacion.fortalezas,
    areasDeMejora: evaluacion.areasDeMejora,
  });
  console.log(`✅ Entrevista guardada en MongoDB (id: ${id}) — aprobado: ${evaluacion.aprobado}`);

  sessions.delete(sessionId);
  eliminarSesion(sessionId).catch((err) =>
    console.error("Error borrando la sesión ya finalizada:", err)
  );
}

const PORT = process.env.PORT || 3000;

asegurarIndiceSesiones()
  .catch((err) => console.error("⚠️  No se pudo crear el índice TTL de sesiones:", err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    });
  });
