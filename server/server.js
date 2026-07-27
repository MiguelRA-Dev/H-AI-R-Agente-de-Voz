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
import { guardarEntrevista } from "./db.js";
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
  console.warn(
    "⚠️  Falta MONGODB_URI en server/.env — la entrevista va a funcionar igual, pero los " +
      "resultados no se van a poder guardar."
  );
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

// Sesiones activas en memoria: sessionId -> { vacante, chat, plan, mensajes, turnos, finalizada }
const sessions = new Map();

const MENSAJE_ARRANQUE =
  "Ya puedes iniciar la entrevista: da la bienvenida al candidato siguiendo el paso 1 de tus instrucciones.";

const MENSAJE_CIERRE_FORZADO =
  "Gracias por tu tiempo y por tus respuestas. Con esto damos por terminada la entrevista.";

// Crea la sesión: genera el plan de preguntas para la vacante, arma el chat con el
// entrevistador ya perfilado, y hace que la IA abra la conversación ella misma.
app.post("/api/session", async (req, res) => {
  const vacante = (req.body?.vacante || "").trim();
  if (!vacante) {
    return res.status(400).json({ error: "Falta indicar la vacante." });
  }

  try {
    const plan = await generarPlanEntrevista(vacante);
    const chat = crearChatEntrevista(vacante, plan);
    const apertura = await chat.sendMessage({ message: MENSAJE_ARRANQUE });

    const sessionId = randomUUID();
    sessions.set(sessionId, {
      vacante,
      chat,
      plan,
      mensajes: [{ role: "ai", text: apertura.text }],
      turnos: 0,
      finalizada: false,
    });

    res.json({
      sessionId,
      openingText: apertura.text,
      vacante,
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

  const session = sessions.get(sessionId);
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
    finalizarYGuardar(session).catch((err) =>
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

    if (finalizada) {
      finalizarYGuardar(session).catch((err) =>
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
async function finalizarYGuardar(session) {
  const evaluacion = await evaluarEntrevista(session.vacante, session.mensajes);
  const id = await guardarEntrevista({
    vacante: session.vacante,
    candidato: evaluacion.nombreCandidato,
    transcripcion: session.mensajes,
    aprobado: evaluacion.aprobado,
    puntaje: evaluacion.puntaje,
    resumen: evaluacion.resumen,
    fortalezas: evaluacion.fortalezas,
    areasDeMejora: evaluacion.areasDeMejora,
  });
  console.log(`✅ Entrevista guardada en MongoDB (id: ${id}) — aprobado: ${evaluacion.aprobado}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
