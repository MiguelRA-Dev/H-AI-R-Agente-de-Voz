import express from "express";
import { rateLimit } from "express-rate-limit";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  MARCA_FIN,
  generarPlanEntrevista,
  crearChatEntrevista,
  evaluarEntrevista,
  enviarMensaje,
} from "./gemini.js";
import {
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
} from "./db.js";
import {
  debeForzarCierre,
  construirMensajeConNota,
  extraerCierre,
  extraerPregunta,
  construirAlertas,
  MARCA_PREGUNTA_INICIO,
  MARCA_PREGUNTA_FIN,
} from "./entrevistaLogica.js";
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
    "⚠️  Falta AZURE_SPEECH_KEY o AZURE_SPEECH_REGION en server/.env — la voz cae de vuelta al " +
      "TTS del navegador."
  );
}
const app = express();
// Confía en el primer salto de proxy (Render/Railway/etc. ponen la app detrás
// de exactamente uno) para que `req.ip` sea la IP real del candidato — sin
// esto, todo el tráfico se ve como una sola IP (el proxy) y el rate limiting
// de abajo no sirve de nada.
app.set("trust proxy", 1);
app.use(express.json());

// Límites generosos a propósito: varios candidatos de la misma empresa
// entrevistando a la vez suelen compartir la IP pública de su oficina, y no
// deben chocar entre ellos. El objetivo es frenar un script automatizado
// (cientos/miles de peticiones por minuto), no a un grupo de gente real
// usando el producto al mismo tiempo.
function limitador(opciones) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Espera un momento y vuelve a intentar." },
    ...opciones,
  });
}

// Arrancar una entrevista es lo más caro por petición (genera el plan completo
// con Gemini) — el límite más estricto de los cuatro.
const limiteSession = limitador({ windowMs: 15 * 60 * 1000, limit: 30 });
// Cada turno de la conversación llama a Gemini; una entrevista real hace como
// máximo ~24 turnos en 15-20 minutos, así que hay margen de sobra para varias
// entrevistas concurrentes de la misma IP.
const limiteMessage = limitador({ windowMs: 10 * 60 * 1000, limit: 200 });
const limiteTts = limitador({ windowMs: 10 * 60 * 1000, limit: 250 });
const limiteVacantes = limitador({ windowMs: 10 * 60 * 1000, limit: 100 });

// En producción (después de `npm run build` en /client) esto sirve la app de
// React ya compilada. En desarrollo Vite corre aparte y le hace proxy a /api.
app.use(express.static(path.join(__dirname, "../client/dist")));

// Caché en memoria de sesiones activas — evita ir a Mongo en cada turno.
// La fuente de verdad es la colección "sesiones_activas" (ver db.js): si el
// servidor se reinicia a mitad de una entrevista, este Map queda vacío pero
// la sesión sigue en Mongo, y `obtenerSesionActiva` la reconstruye sola en
// la siguiente petición (rehidratación perezosa).
// sessionId -> { vacante, vacanteId, vacanteInfo, cedula, celular, chat, plan, mensajes, turnos, finalizada, avisoPrivacidadAceptadoEn }
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
    construirHistorialGemini(guardada.mensajes),
    guardada.nombreCompleto
  );

  const session = { ...guardada, chat };
  delete session._id;
  delete session.actualizadoEn;

  sessions.set(sessionId, session);
  console.log(`↻ Sesión ${sessionId} reconstruida desde Mongo (el servidor se reinició).`);
  return session;
}

// Resuelve el slug de empresa que manda el cliente (ver App.jsx, lee "/e/:slug"
// de la URL) a su organización real. Centralizado acá porque lo necesitan
// tanto /api/vacantes como /api/session, con el mismo mensaje de error si el
// link está mal escrito o la empresa no existe.
async function resolverOrganizacion(slug, res) {
  const limpio = (slug || "").trim();
  if (!limpio) {
    res.status(400).json({ error: "Falta el enlace de la empresa." });
    return null;
  }
  const organizacion = await obtenerOrganizacionPorSlug(limpio);
  if (!organizacion) {
    res.status(404).json({ error: "No encontramos la empresa de este enlace." });
    return null;
  }
  return organizacion;
}

// Lista las vacantes que RRHH dejó publicadas en su dashboard, para que el
// candidato elija una en vez de escribir el puesto a mano. Solo las de la
// empresa cuyo link abrió el candidato (?empresa=slug).
app.get("/api/vacantes", limiteVacantes, async (req, res) => {
  const organizacion = await resolverOrganizacion(req.query.empresa, res);
  if (!organizacion) return;

  try {
    const vacantes = await obtenerVacantesPublicadas(organizacion.id);
    res.json({
      vacantes,
      organizacion: { nombre: organizacion.nombre, logoUrl: organizacion.logoUrl || null },
    });
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
app.post("/api/session", limiteSession, async (req, res) => {
  const vacanteId = (req.body?.vacanteId || "").trim();
  const nombreCompleto = (req.body?.nombreCompleto || "").trim();
  const cedula = (req.body?.cedula || "").trim();
  const celular = (req.body?.celular || "").trim();

  const organizacion = await resolverOrganizacion(req.body?.empresaSlug, res);
  if (!organizacion) return;

  if (!vacanteId) {
    return res.status(400).json({ error: "Falta seleccionar una vacante." });
  }
  // Nombre, cédula y celular se piden acá, escritos a mano, en vez de que la IA
  // los pida por voz: son datos donde un error de transcripción pesa mucho más
  // que en una respuesta de texto libre (el nombre ya daba varios errores de
  // validación cuando se lo pedíamos hablado).
  if (!nombreCompleto || !cedula || !celular) {
    return res
      .status(400)
      .json({ error: "Falta el nombre completo, la cédula o el número de celular." });
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
    // organizacion.id va en el filtro, no solo el vacanteId: sin esto, alguien
    // con el link de una empresa podría pasar el id de la vacante de otra
    // empresa y arrancar una entrevista ahí.
    const vacante = await obtenerVacantePorId(vacanteId, organizacion.id);
    if (!vacante) {
      return res.status(404).json({ error: "La vacante seleccionada ya no está disponible." });
    }

    const plan = await generarPlanEntrevista(vacante);
    const chat = crearChatEntrevista(vacante, plan, [], nombreCompleto);
    const aperturaCruda = await enviarMensaje(chat, { message: MENSAJE_ARRANQUE });
    // "pregunta" es solo lo que el modelo marcó como la pregunta puntual (ver
    // instruccionPregunta en gemini.js), para mostrarla aparte del saludo —
    // "texto" sigue siendo el mensaje completo, el que de verdad se habla.
    const { texto: aperturaTexto, pregunta: aperturaPregunta } = extraerPregunta(
      aperturaCruda.text,
      MARCA_PREGUNTA_INICIO,
      MARCA_PREGUNTA_FIN
    );

    const sessionId = randomUUID();
    const session = {
      organizacionId: organizacion.id,
      vacante: vacante.titulo,
      vacanteId: vacante.id,
      vacanteInfo: vacante,
      nombreCompleto,
      cedula,
      celular,
      chat,
      plan,
      mensajes: [{ role: "ai", text: aperturaTexto }],
      turnos: 0,
      finalizada: false,
      avisoPrivacidadAceptadoEn: new Date(),
      // Cuántas veces el cliente detectó que el candidato salió de la pestaña/ventana
      // (ver useTabVisibility en el cliente). Señal para RRHH, nunca cambia "aprobado".
      cambiosPantalla: 0,
    };
    sessions.set(sessionId, session);
    await guardarSesion(sessionId, sesionPersistible(session));

    res.json({
      sessionId,
      openingText: aperturaTexto,
      preguntaTexto: aperturaPregunta,
      vacante: vacante.titulo,
      totalPreguntas: plan.totalPreguntas,
      idioma: vacante.idioma === "en" ? "en" : "es",
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
app.post("/api/message", limiteMessage, async (req, res) => {
  const { sessionId, message, cambiosPantalla } = req.body || {};

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

  // El cliente manda el total acumulado en cada turno (no un delta): tomamos el
  // máximo para no retroceder el conteo si una petición llega desordenada/duplicada.
  session.cambiosPantalla = Math.max(session.cambiosPantalla || 0, Number(cambiosPantalla) || 0);

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
    const respuesta = await enviarMensaje(session.chat, { message: mensajeAEnviar });
    const { texto: textoSinMarcaPregunta, pregunta } = extraerPregunta(
      respuesta.text,
      MARCA_PREGUNTA_INICIO,
      MARCA_PREGUNTA_FIN
    );
    const { texto, finalizada } = extraerCierre(textoSinMarcaPregunta, MARCA_FIN);

    if (finalizada) {
      session.finalizada = true;
    }

    session.mensajes.push({ role: "user", text: message });
    session.mensajes.push({ role: "ai", text: texto });
    session.turnos = turnoSiguiente;

    res.json({
      text: texto,
      preguntaTexto: pregunta,
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
// al TTS del navegador si esto falla o si no hay credenciales de Azure Speech.
app.post("/api/tts", limiteTts, async (req, res) => {
  const { text, idioma } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Falta el texto a sintetizar." });
  }
  if (!ttsDisponible()) {
    return res.status(503).json({ error: "TTS de Azure Speech no está configurado." });
  }

  try {
    const { audio, contentType } = await sintetizarVoz(text, idioma === "en" ? "en" : "es");
    res.set("Content-Type", contentType);
    res.send(audio);
    registrarUsoTts(text.length).catch((err) =>
      console.error("Error registrando el uso de TTS:", err)
    );
  } catch (err) {
    console.error("Error generando audio con Azure Speech:", err);
    res.status(500).json({ error: "No se pudo generar el audio." });
  }
});

// Consumo del mes en curso contra el tier gratuito F0 de Azure Speech
// (500.000 caracteres/mes). El portal de Azure no siempre muestra este
// dato (depende del tipo de suscripción), así que lo llevamos aparte.
const LIMITE_TTS_MENSUAL = 500000;

app.get("/api/tts/uso", async (req, res) => {
  try {
    const uso = await obtenerUsoTts();
    res.json({
      ...uso,
      limiteMensual: LIMITE_TTS_MENSUAL,
      porcentaje: Math.round((uso.caracteres / LIMITE_TTS_MENSUAL) * 1000) / 10,
    });
  } catch (err) {
    console.error("Error obteniendo el uso de TTS:", err);
    res.status(500).json({ error: "No se pudo obtener el uso de TTS." });
  }
});

// Evalúa la entrevista completa y la guarda en MongoDB. Corre en segundo plano
// (no bloquea la respuesta al candidato) para que el cierre se sienta inmediato.
// Al terminar, limpia la sesión en curso (caché y Mongo): ya quedó capturada
// para siempre en "entrevistas", no hace falta seguir guardándola aparte.
async function finalizarYGuardar(sessionId, session) {
  const evaluacion = await evaluarEntrevista(session.vacante, session.mensajes);
  const alertas = construirAlertas(
    session.cambiosPantalla,
    evaluacion.posibleUsoIA,
    evaluacion.justificacionUsoIA
  );
  const id = await guardarEntrevista({
    organizacionId: session.organizacionId,
    vacante: session.vacante,
    vacanteId: session.vacanteId,
    // Del formulario, no de lo que la IA haya entendido por voz — es la fuente
    // de verdad del nombre, igual que cédula y celular.
    candidato: session.nombreCompleto,
    cedula: session.cedula,
    celular: session.celular,
    avisoPrivacidadAceptadoEn: session.avisoPrivacidadAceptadoEn,
    transcripcion: session.mensajes,
    aprobado: evaluacion.aprobado,
    puntaje: evaluacion.puntaje,
    competencias: evaluacion.competencias,
    resumen: evaluacion.resumen,
    fortalezas: evaluacion.fortalezas,
    areasDeMejora: evaluacion.areasDeMejora,
    alertas,
  });
  console.log(
    `✅ Entrevista guardada en MongoDB (id: ${id}) — aprobado: ${evaluacion.aprobado}` +
      (alertas.cambiosPantalla > 0 || alertas.posibleUsoIA
        ? ` — ⚠️ alertas: cambiosPantalla=${alertas.cambiosPantalla}, posibleUsoIA=${alertas.posibleUsoIA}`
        : "")
  );

  sessions.delete(sessionId);
  eliminarSesion(sessionId).catch((err) =>
    console.error("Error borrando la sesión ya finalizada:", err)
  );
}

// El cliente no tiene router: lee el slug de la empresa directo de
// window.location.pathname (ver App.jsx, patrón "/e/:slug"). express.static
// de arriba solo sirve archivos reales (JS/CSS/etc.) — sin esto, pedir esa
// ruta directo (no navegando desde "/") daría 404 en vez de cargar la app.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

const PORT = process.env.PORT || 3000;

asegurarIndiceSesiones()
  .catch((err) => console.error("⚠️  No se pudo crear el índice TTL de sesiones:", err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    });
  });
