import { GoogleGenAI } from "@google/genai";
import { calcularAprobado } from "./entrevistaLogica.js";

function getAI() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
}

export const MODELO = "gemini-3.5-flash-lite";

export const MARCA_FIN = "[ENTREVISTA_FINALIZADA]";

const ESTILO_VOZ =
  "Responde siempre en español, en frases cortas y naturales, como si hablaras en voz alta. " +
  "No uses markdown, asteriscos, listas con guiones ni encabezados: tu respuesta se va a " +
  "convertir directamente a audio.";

// Pregunta 0: siempre va primero, antes que el plan generado por Gemini, para que
// la entrevista arranque conociendo a la persona y no se sienta solo un examen técnico.
// Cédula y celular ya no se piden acá: se capturan en un formulario antes de empezar
// (ver VacanteSetup.jsx), porque son datos donde un error de transcripción por voz
// pesa mucho más que en una respuesta de texto libre.
export const PREGUNTA_INTRO = {
  tema: "Presentación personal",
  pregunta:
    "Antes de entrar en materia, pídele su nombre completo y pídele que se presente " +
    "brevemente: quién es, su trayectoria y qué lo trae a postularse a esta vacante.",
};

const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    totalPreguntas: { type: "NUMBER" },
    preguntas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tema: { type: "STRING" },
          pregunta: { type: "STRING" },
        },
        required: ["tema", "pregunta"],
      },
    },
  },
  required: ["totalPreguntas", "preguntas"],
};

const EVALUACION_SCHEMA = {
  type: "OBJECT",
  properties: {
    puntaje: {
      type: "INTEGER",
      minimum: 0,
      maximum: 100,
      description:
        "Puntaje del candidato en una escala fija de 0 a 100 (nunca de 0 a 10 ni de 0 a 5), " +
        "evaluando conocimiento técnico relevante para la vacante, claridad de comunicación y " +
        "calidad/completitud de las respuestas.",
    },
    resumen: { type: "STRING" },
    fortalezas: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    areasDeMejora: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    nombreCandidato: { type: "STRING" },
  },
  required: ["puntaje", "resumen", "fortalezas", "areasDeMejora", "nombreCandidato"],
};

// Recorta el plan que devuelve Gemini a máximo 20 preguntas técnicas y le
// antepone la pregunta de presentación personal. Separado de la llamada a la
// API para poder probarlo con arreglos de prueba, sin gastar cuota de Gemini.
export function normalizarPlan(preguntasCrudas) {
  const preguntas = preguntasCrudas.slice(0, 20);
  preguntas.unshift(PREGUNTA_INTRO);
  return { preguntas, totalPreguntas: preguntas.length };
}

export async function generarPlanEntrevista(vacante) {
  const ai = getAI();

  const prompt =
    "Genera un plan de entrevista de trabajo para esta vacante, publicada por la empresa " +
    "en su portal de RRHH:\n\n" +
    `Título: ${vacante.titulo}\n` +
    `Ubicación / modalidad: ${vacante.ubicacion} (${vacante.modalidad})\n` +
    `Descripción: ${vacante.descripcion}\n` +
    `Requisitos: ${vacante.requisitos}\n\n` +
    "Basa las preguntas en la descripción y los requisitos reales de arriba, no en suposiciones " +
    "genéricas a partir del título. Piensa en las competencias técnicas y blandas más relevantes " +
    "para este rol específico. Genera entre 12 y 20 preguntas de perfilamiento.";

  const response = await ai.models.generateContent({
    model: MODELO,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: PLAN_SCHEMA,
      thinkingConfig: { thinkingLevel: "LOW" },
    },
  });

  const plan = JSON.parse(response.text);
  const { preguntas, totalPreguntas } = normalizarPlan(plan.preguntas);
  plan.preguntas = preguntas;
  plan.totalPreguntas = totalPreguntas;

  return plan;
}

function construirInstruccionSistema(vacante, plan) {
  const listaPreguntas = plan.preguntas
    .map((p, i) => `${i + 1}. [${p.tema}] ${p.pregunta}`)
    .join("\n");

  const instruccionTono =
    "La pregunta 1 es de presentación personal, no técnica: úsala para romper el hielo, " +
    "conocer a la persona y hacer que se sienta en una conversación humana, no en un examen. " +
    "A partir de la pregunta 2 entra en materia con el perfil técnico y de competencias.";

  const instruccionCierre =
    `Haz estas ${plan.totalPreguntas} preguntas una por una, en el orden dado, sin saltarte ` +
    "ninguna y sin agregar preguntas extra. En cuanto el candidato responda la última " +
    `(la número ${plan.totalPreguntas}), agradécele su tiempo y cierra la entrevista en ese ` +
    "mismo mensaje: no hagas más preguntas ni sigas la conversación. Para cerrar, termina tu " +
    `respuesta agregando exactamente la marca ${MARCA_FIN} al final (nunca la menciones ni la ` +
    "expliques al candidato, es solo una señal interna).";

  return (
    `Eres un entrevistador profesional para la vacante "${vacante.titulo}" ` +
    `(${vacante.ubicacion}, modalidad ${vacante.modalidad}).\n\n` +
    listaPreguntas +
    "\n\n" +
    instruccionTono +
    "\n\n" +
    instruccionCierre +
    "\n\n" +
    ESTILO_VOZ
  );
}

// `history` (opcional) reconstruye una entrevista ya en curso —tras un
// reinicio del servidor— a partir de los mensajes guardados en Mongo, en vez
// de arrancar una conversación nueva. Debe alternar roles 'user'/'model' y
// empezar en 'user' (lo arma `construirHistorialGemini` en server.js).
export function crearChatEntrevista(vacante, plan, history = []) {
  const ai = getAI();

  return ai.chats.create({
    model: MODELO,
    config: {
      systemInstruction: construirInstruccionSistema(vacante, plan),
      // Respuestas habladas cortas por diseño (ver ESTILO_VOZ): limitamos la
      // salida para no pagar tokens de más en un texto que igual se va a leer en voz alta.
      // thinkingLevel bajo porque, sin él, el modelo gasta el maxOutputTokens
      // pensando y corta la respuesta visible a mitad de frase.
      maxOutputTokens: 220,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    },
    history,
  });
}

export async function evaluarEntrevista(vacante, mensajes) {
  const ai = getAI();

  const transcripcion = mensajes
    .map((m) => `${m.role === "user" ? "CANDIDATO" : "ENTREVISTADOR"}: ${m.text}`)
    .join("\n");

  const prompt =
    `Evalúa esta entrevista de trabajo para la vacante "${vacante}".\n\n` +
    transcripcion +
    "\n\n" +
    "Usa siempre esta referencia para que el puntaje (0-100) sea consistente entre distintas " +
    "entrevistas, sin importar qué tan generoso o estricto te sientas hoy: 90-100 candidato " +
    "excelente, 70-89 buen candidato, 50-69 regular, 0-49 insuficiente para el puesto.";

  const response = await ai.models.generateContent({
    model: MODELO,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: EVALUACION_SCHEMA,
      thinkingConfig: { thinkingLevel: "LOW" },
    },
  });

  const evaluacion = JSON.parse(response.text);
  evaluacion.aprobado = calcularAprobado(evaluacion.puntaje);

  return evaluacion;
}