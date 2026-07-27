import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reconocimiento de voz (STT) usando la Web Speech API del navegador.
 *
 * OJO con esto: usamos `continuous = true` a propósito. Con `continuous =
 * false` el navegador corta la grabación solo, apenas detecta una pausa
 * corta (a veces basta con respirar). Con `continuous = true` el micrófono
 * se queda escuchando sin cortar por pausas cortas, y es el usuario quien
 * decide cuándo terminar volviendo a tocar el botón/orbe (ver `stop`).
 */
export function useSpeechRecognition({ lang }) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const onFinalResultRef = useRef(null);

  const SpeechRecognitionImpl =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const supported = Boolean(SpeechRecognitionImpl);

  // onFinalResult recibe el texto final (puede ser "" si no se dijo nada).
  const start = useCallback(
    (onFinalResult) => {
      if (!supported || recognitionRef.current) return;

      onFinalResultRef.current = onFinalResult;
      finalTranscriptRef.current = "";
      setInterimText("");
      setError(null);

      const rec = new SpeechRecognitionImpl();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscriptRef.current += chunk + " ";
          } else {
            interim += chunk;
          }
        }
        setInterimText(interim);
      };

      rec.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("Necesito permiso para el micrófono. Revisa los permisos del navegador.");
        } else if (event.error === "no-speech") {
          setError("No escuché nada.");
        } else if (event.error !== "aborted") {
          setError("Ocurrió un error con el micrófono.");
        }
      };

      rec.onend = () => {
        setIsListening(false);
        setInterimText("");
        recognitionRef.current = null;
        const text = finalTranscriptRef.current.trim();
        onFinalResultRef.current?.(text);
      };

      recognitionRef.current = rec;
      rec.start();
      setIsListening(true);
    },
    [supported, lang, SpeechRecognitionImpl]
  );

  // Le pide al reconocimiento que termine YA. Esto dispara "onend" arriba,
  // que entrega el texto final acumulado hasta ese momento.
  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Por si el componente se desmonta mientras se está escuchando.
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  return { isListening, interimText, error, supported, start, stop };
}
