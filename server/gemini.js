import { GoogleGenAI } from "@google/genai";
import { calcularAprobado, calcularPuntajeGlobal } from "./entrevistaLogica.js";

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

// Los 4 ejes en los que se descompone la evaluación, cada uno 0-100. El puntaje
// global que ve RRHH nunca se le pide al modelo: se calcula como el promedio de
// estos cuatro con calcularPuntajeGlobal() (ver entrevistaLogica.js), para que la
// evaluación sea explicable (por qué reprobó) y no dependa de qué tan generoso
// haya estado Gemini puntuando el número global en una entrevista puntual.
const EVALUACION_SCHEMA = {
  type: "OBJECT",
  properties: {
    competencias: {
      type: "OBJECT",
      properties: {
        conocimientoTecnico: {
          type: "INTEGER",
          minimum: 0,
          maximum: 100,
          description:
            "Dominio de los conocimientos técnicos y de dominio específico que pide la vacante " +
            "(los requisitos reales, no suposiciones genéricas por el título).",
        },
        comunicacion: {
          type: "INTEGER",
          minimum: 0,
          maximum: 100,
          description:
            "Claridad, estructura y capacidad de explicarse hablando: ¿se le entiende fácil, " +
            "organiza sus ideas, o divaga/se contradice?",
        },
        resolucionProblemas: {
          type: "INTEGER",
          minimum: 0,
          maximum: 100,
          description:
            "Razonamiento práctico y analítico: cómo aborda situaciones hipotéticas o problemas " +
            "planteados, no solo si recita teoría de memoria.",
        },
        fitRol: {
          type: "INTEGER",
          minimum: 0,
          maximum: 100,
          description:
            "Qué tan alineado está con esta vacante en particular: motivación, expectativas y " +
            "encaje con la modalidad/seniority del puesto, más allá de lo puramente técnico.",
        },
      },
      required: ["conocimientoTecnico", "comunicacion", "resolucionProblemas", "fitRol"],
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
    posibleUsoIA: {
      type: "BOOLEAN",
      description:
        "true solo si, revisando toda la transcripción, hay señales concretas de que el " +
        "candidato leyó respuestas generadas por IA o buscadas en internet en vez de responder " +
        "con conocimiento propio: respuestas perfectas y genéricas que no se sostienen cuando el " +
        "entrevistador repregunta por un detalle concreto, o cambios de estilo abruptos entre " +
        "respuestas. No lo marques true solo porque una respuesta sea buena o esté bien " +
        "estructurada.",
    },
    justificacionUsoIA: {
      type: "STRING",
      description:
        "Si posibleUsoIA es true, explica en 1-2 frases qué te hizo sospechar, citando el tema " +
        "de la pregunta. Si es false, deja este campo como cadena vacía.",
    },
  },
  required: [
    "competencias",
    "resumen",
    "fortalezas",
    "areasDeMejora",
    "nombreCandidato",
    "posibleUsoIA",
    "justificacionUsoIA",
  ],
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

  // Contramedida contra respuestas leídas de Google/otra IA en vez de conocimiento propio:
  // en vez de aceptarlas de inmediato, se le pide al modelo un detalle concreto y personal
  // antes de seguir. Solo cuando genera dudas reales, para no interrogar a quien solo fue conciso.
  const instruccionAntitrampa =
    "Si una respuesta te suena demasiado genérica o ensayada para ser espontánea —perfecta y " +
    "bien estructurada pero sin ningún detalle personal, sin dudas ni matices propios del habla, " +
    "como si viniera de buscarla en internet o pedírsela a otra IA— no la des por buena ni pases " +
    "a la siguiente pregunta todavía: haz primero una repregunta corta pidiendo un ejemplo " +
    "concreto y personal (\"cuéntame de una vez específica en la que...\", \"¿y cómo lo " +
    "resolverías si...\"). Hazlo solo cuando realmente te genere esa duda, no con cada respuesta.";

  return (
    `Eres un entrevistador profesional para la vacante "${vacante.titulo}" ` +
    `(${vacante.ubicacion}, modalidad ${vacante.modalidad}).\n\n` +
    listaPreguntas +
    "\n\n" +
    instruccionTono +
    "\n\n" +
    instruccionCierre +
    "\n\n" +
    instruccionAntitrampa +
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
    "Usa siempre esta referencia para que cada eje de 'competencias' (0-100) sea consistente " +
    "entre distintas entrevistas, sin importar qué tan generoso o estricto te sientas hoy: " +
    "90-100 excelente, 70-89 bueno, 50-69 regular, 0-49 insuficiente para el puesto. Califica " +
    "cada eje por separado según lo que realmente mostró el candidato en esa dimensión " +
    "específica, no repitas el mismo número en los cuatro solo porque la impresión general fue " +
    "buena o mala.\n\n" +
    "Revisa también si hay señales de que el candidato usó IA/internet para responder en vez de " +
    "conocimiento propio (ver posibleUsoIA en el esquema): presta especial atención a los tramos " +
    "donde el entrevistador repreguntó pidiendo un ejemplo concreto y personal, y evalúa si la " +
    "respuesta a esa repregunta sí aterrizó en algo específico o si el candidato la evadió o dio " +
    "otra respuesta igual de genérica.";

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
  evaluacion.puntaje = calcularPuntajeGlobal(evaluacion.competencias);
  evaluacion.aprobado = calcularAprobado(evaluacion.puntaje);

  return evaluacion;
}