const VOZ = "es-CO-GonzaloNeural"; // voz neural en español de Colombia
const IDIOMA = "es-CO";
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

// Convierte texto a voz natural vía Azure AI Speech (tier gratuito F0).
// Devuelve los bytes de audio en mp3 y el content-type que hay que
// reenviarle al navegador.
export async function sintetizarVoz(texto) {
  const url = `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml =
    `<speak version="1.0" xml:lang="${IDIOMA}">` +
    `<voice xml:lang="${IDIOMA}" name="${VOZ}">${escaparSsml(texto)}</voice>` +
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
