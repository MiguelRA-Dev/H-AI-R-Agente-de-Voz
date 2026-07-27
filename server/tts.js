const CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-03-01";
const MODELO_VOZ = "sonic-3.5";

export function ttsDisponible() {
  return Boolean(process.env.CARTESIA_API_KEY && process.env.CARTESIA_VOICE_ID);
}

// Convierte texto a voz natural vía Cartesia. Devuelve los bytes de audio en
// mp3 y el content-type que hay que reenviarle al navegador.
export async function sintetizarVoz(texto) {
  const respuesta = await fetch(CARTESIA_TTS_URL, {
    method: "POST",
    headers: {
      "Cartesia-Version": CARTESIA_VERSION,
      Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: MODELO_VOZ,
      transcript: texto,
      voice: { mode: "id", id: process.env.CARTESIA_VOICE_ID },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "es",
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`Cartesia respondió ${respuesta.status}: ${detalle}`);
  }

  const audio = Buffer.from(await respuesta.arrayBuffer());
  return { audio, contentType: respuesta.headers.get("content-type") || "audio/mpeg" };
}
