// Reglas puras del ciclo de vida de una entrevista: cuándo forzar el cierre,
// cuándo avisarle al modelo que ya va la última pregunta, y cómo leer la marca
// de fin en su respuesta. Sin dependencias de Express/Gemini/Mongo para poder
// probarlas de forma aislada.

export const MARGEN_TURNOS_EXTRA = 3;

// Si el modelo no cerró solo tras el margen de seguridad, el servidor cierra
// él mismo sin volver a llamarlo.
export function debeForzarCierre(turnoSiguiente, totalPreguntas, margen = MARGEN_TURNOS_EXTRA) {
  return turnoSiguiente > totalPreguntas + margen;
}

export function esUltimaPreguntaPlaneada(turnoSiguiente, totalPreguntas) {
  return turnoSiguiente >= totalPreguntas;
}

export function construirMensajeConNota(mensaje, turnoSiguiente, totalPreguntas) {
  if (!esUltimaPreguntaPlaneada(turnoSiguiente, totalPreguntas)) return mensaje;
  return (
    mensaje +
    " (Nota interna: esa fue la última pregunta planeada, cierra la entrevista ahora mismo " +
    "agradeciendo al candidato, sin hacer más preguntas, y agrega la marca de fin.)"
  );
}

// Detecta la marca de fin en la respuesta del modelo y devuelve el texto ya
// limpio para mostrar/hablar.
export function extraerCierre(texto, marcaFin) {
  const finalizada = texto.includes(marcaFin);
  const textoLimpio = finalizada ? texto.replace(marcaFin, "").trim() : texto;
  return { texto: textoLimpio, finalizada };
}

// Puntaje siempre en escala fija de 0 a 100 (ver EVALUACION_SCHEMA en gemini.js).
// "aprobado" se calcula acá, no se le pide al modelo, para que el criterio de
// corte sea siempre el mismo sin importar qué tan generoso o estricto esté
// Gemini puntuando en una evaluación en particular.
export const UMBRAL_APROBACION = 70;

export function calcularAprobado(puntaje, umbral = UMBRAL_APROBACION) {
  return puntaje >= umbral;
}
