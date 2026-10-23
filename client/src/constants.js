// BCP-47 para el reconocimiento de voz (STT) y la síntesis de respaldo del
// navegador (TTS, cuando Azure no está disponible) — según el idioma que el
// admin configuró en la vacante (ver VacanteForm.jsx en el dashboard).
const IDIOMA_A_BCP47 = {
  es: "es-CO",
  en: "en-US",
};

export function bcp47DeIdioma(idioma) {
  return IDIOMA_A_BCP47[idioma] || IDIOMA_A_BCP47.es;
}

// Se habla UNA vez, apenas arranca la entrevista, antes del saludo que genera
// Gemini — texto fijo (no lo escribe el modelo) porque Gemini no sabe nada de
// cómo funciona el micrófono en esta interfaz en particular; esto sí lo
// sabemos nosotros y queremos que quede siempre igual, sin depender de que
// el modelo lo describa bien. Sin "soy un asistente de IA" a propósito: que
// suene a una persona dándote la bienvenida, no a una interfaz presentándose
// (el aviso de que la entrevista es con un agente de voz ya se lo mostró el
// formulario de antes, con su aceptación — ver VacanteSetup.jsx).
export const INSTRUCCIONES_INICIALES = {
  es:
    "Hola, qué bueno tenerte por acá. Antes de empezar, dos cosas rápidas: toca el micrófono " +
    "cuando quieras responder, y tócalo de nuevo cuando termines de hablar. Tómate tu tiempo, no " +
    "hay afán. Ahora sí, vamos a comenzar.",
  en:
    "Hi, it's great to have you here. Before we start, two quick things: tap the microphone " +
    "whenever you want to answer, and tap it again when you're done talking. Take your time, " +
    "there's no rush. Now, let's get started.",
};
