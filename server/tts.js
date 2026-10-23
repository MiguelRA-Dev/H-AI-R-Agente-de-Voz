// Una voz neural por idioma de entrevista (ver vacante.idioma). "es" es el
// default histórico; "en" se agrega para las vacantes bilingües. Las dos son
// de la familia "Multilingual" de Azure — mejor prosodia que las voces Neural
// clásicas (GuyNeural/GonzaloNeural), mismo costo. Azure no tiene una
// Multilingual con acento colombiano (ver secondaryLocaleList del catálogo:
// solo es-ES/es-MX/es-US), así que español usa acento mexicano con Ava.
//
// Se probó Serena (sí soporta estilos expresivos, a diferencia de Ava) para
// español, pero el acento sonaba demasiado marcado/gringo — se vuelve a Ava.
// "estilo" queda opcional: Ava no soporta ninguno (Azure lo ignora en
// silencio si se lo mandamos, verificado contra la documentación oficial),
// así que para "es" no se manda express-as en absoluto. Andrew (inglés) sí
// soporta "empathetic", así que ahí se queda activado.
const VOCES = {
  es: { voz: "en-US-AvaMultilingualNeural", idioma: "es-MX" },
  en: { voz: "en-US-AndrewMultilingualNeural", idioma: "en-US", estilo: "empathetic" },
};
const FORMATO_AUDIO = "audio-24khz-160kbitrate-mono-mp3";

export function ttsDisponible() {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

// SSML es XML: escapa los caracteres reservados para que un nombre o texto
// con "&", comillas, etc. no rompa el documento que le mandamos a Azure.
function escaparSsml(texto) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Inserta una pausa corta después de cada fin de oración (., !, ?, …) que
// venga seguido de espacio — nunca al final del texto (ahí ya respira solo
// al cortar el audio) ni a mitad de una abreviatura pegada sin espacio.
// Opera sobre el texto YA escapado, así que las etiquetas que agrega acá no
// se vuelven a escapar después.
function conPausasNaturales(textoEscapado) {
  return textoEscapado.replace(/([.!?…])(\s+)/g, '$1<break time="320ms"/>$2');
}

// Convierte texto a voz natural vía Azure AI Speech (tier gratuito F0).
// Devuelve los bytes de audio en mp3 y el content-type que hay que
// reenviarle al navegador.
export async function sintetizarVoz(texto, idioma = "es") {
  const { voz, idioma: locale, estilo } = VOCES[idioma] || VOCES.es;
  const url = `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const textoConPausas = conPausasNaturales(escaparSsml(texto));
  const contenido = estilo
    ? `<mstts:express-as style="${estilo}">${textoConPausas}</mstts:express-as>`
    : textoConPausas;
  const ssml =
    `<speak version="1.0" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice xml:lang="${locale}" name="${voz}">${contenido}</voice>` +
    `</speak>`;

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": FORMATO_AUDIO,
      "User-Agent": "agente-voz-h-air",
    },
    body: ssml,
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`Azure Speech respondió ${respuesta.status}: ${detalle}`);
  }

  const audio = Buffer.from(await respuesta.arrayBuffer());
  return { audio, contentType: "audio/mpeg" };
}
