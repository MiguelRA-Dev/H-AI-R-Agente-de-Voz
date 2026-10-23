import { useCallback, useRef } from "react";

function hablarConNavegador(text, lang, onEnd) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

/**
 * Síntesis de voz (TTS) natural vía Azure AI Speech, generada en el servidor
 * para no exponer la API key. Si el servidor no tiene Azure Speech
 * configurado o la llamada falla, cae de vuelta a la voz nativa del
 * navegador para que la entrevista nunca se quede muda.
 */
// idioma/lang se reciben POR LLAMADA (en `speak(texto, { idioma, lang })`), no
// como parámetros del hook: si se leyeran del estado del componente en el
// momento de crear este hook, la primerísima llamada a speak() — la del
// saludo de apertura, justo después de un setIdioma() que todavía no se
// aplicó — se quedaría con el idioma viejo (closure obsoleto de React). Acá
// no hay ese riesgo: cada llamada decide su propio idioma explícitamente.
export function useSpeechSynthesis() {
  const reproduccionRef = useRef(null);

  const detenerAudio = useCallback(() => {
    if (reproduccionRef.current) {
      const { audio, url } = reproduccionRef.current;
      audio.pause();
      URL.revokeObjectURL(url);
      reproduccionRef.current = null;
    }
  }, []);

  const speak = useCallback(
    async (text, { onEnd, idioma, lang } = {}) => {
      detenerAudio();
      window.speechSynthesis.cancel();

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, idioma }),
        });
        if (!res.ok) throw new Error("TTS de Cartesia no disponible");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        reproduccionRef.current = { audio, url };

        await new Promise((resolve, reject) => {
          audio.addEventListener("ended", resolve, { once: true });
          audio.addEventListener("error", reject, { once: true });
          audio.play().catch(reject);
        });

        detenerAudio();
        onEnd?.();
      } catch {
        detenerAudio();
        hablarConNavegador(text, lang, onEnd);
      }
    },
    [detenerAudio]
  );

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
    detenerAudio();
  }, [detenerAudio]);

  return { speak, cancel };
}
