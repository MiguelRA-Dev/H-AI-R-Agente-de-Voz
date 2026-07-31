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

// El puntaje global nunca se le pide al modelo directamente: se calcula acá como el
// promedio de los 4 ejes de competencia (ver EVALUACION_SCHEMA en gemini.js), para que
// no pueda quedar inconsistente con ellos (ej. un promedio real de 60 pero un "puntaje"
// aparte que el modelo puso en 85 por generosidad).
export function calcularPuntajeGlobal(competencias) {
  const valores = Object.values(competencias || {}).map((v) => Number(v) || 0);
  if (valores.length === 0) return 0;
  const suma = valores.reduce((acc, v) => acc + v, 0);
  return Math.round(suma / valores.length);
}

// Junta las dos señales anti-trampa (cambios de pestaña/ventana detectados en el
// cliente + sospecha de uso de IA detectada por el evaluador) en un solo objeto
// para guardar en la entrevista. Es solo dato para RRHH: nunca cambia "aprobado".
export function construirAlertas(cambiosPantalla, posibleUsoIA, justificacionUsoIA) {
  return {
    cambiosPantalla: Number(cambiosPantalla) || 0,
    posibleUsoIA: Boolean(posibleUsoIA),
    justificacionUsoIA: justificacionUsoIA || "",
  };
}
