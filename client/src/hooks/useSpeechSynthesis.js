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
export function useSpeechSynthesis({ lang }) {
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
    async (text, { onEnd } = {}) => {
      detenerAudio();
      window.speechSynthesis.cancel();

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
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
    [lang, detenerAudio]
  );

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
    detenerAudio();
  }, [detenerAudio]);

  return { speak, cancel };
}
