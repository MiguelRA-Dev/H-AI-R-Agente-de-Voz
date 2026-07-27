import { useCallback, useState } from "react";
import VacanteSetup from "./components/VacanteSetup";
import Orb from "./components/Orb";
import ProgressBar from "./components/ProgressBar";
import VoiceBar from "./components/VoiceBar";
import CornerMarks from "./components/CornerMarks";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import { SPEECH_LANG } from "./constants";

// Estados sin caption propia (idle) caen al mensaje por defecto: conversación
// de voz real, no una transcripción en pantalla.
const CAPTION_BY_STATE = {
  thinking: "Pensando…",
  speaking: "Hablando…",
  done: "Entrevista finalizada. Gracias por tu tiempo.",
};

export default function App() {
  const [phase, setPhase] = useState("setup"); // setup | interview
  const [sessionId, setSessionId] = useState(null);
  const [vacante, setVacante] = useState("");
  const [appState, setAppState] = useState("idle"); // idle | listening | thinking | speaking | done
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [starting, setStarting] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [sendError, setSendError] = useState(null);

  const { interimText, error: micError, supported, start, stop } = useSpeechRecognition({
    lang: SPEECH_LANG,
  });
  const { speak, cancel } = useSpeechSynthesis({ lang: SPEECH_LANG });

  const handleStart = useCallback(
    async (vacanteValue) => {
      setStarting(true);
      setSetupError(null);
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vacante: vacanteValue }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo iniciar la entrevista.");

        setSessionId(data.sessionId);
        setVacante(vacanteValue);
        setProgreso({ actual: 0, total: data.totalPreguntas || 0 });
        setPhase("interview");
        setAppState("speaking");
        speak(data.openingText, { onEnd: () => setAppState("idle") });
      } catch (err) {
        setSetupError(err.message);
      } finally {
        setStarting(false);
      }
    },
    [speak]
  );

  const handleReset = useCallback(() => {
    if (phase === "interview" && appState !== "done") {
      const ok = window.confirm(
        "¿Seguro que quieres salir? Se perderá el progreso de esta entrevista."
      );
      if (!ok) return;
    }
    stop();
    cancel();
    setPhase("setup");
    setSessionId(null);
    setProgreso({ actual: 0, total: 0 });
    setAppState("idle");
    setSendError(null);
  }, [phase, appState, stop, cancel]);

  const sendToGemini = useCallback(
    async (text) => {
      setSendError(null);
      setAppState("thinking");

      try {
        const res = await fetch("/api/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error del servidor");

        if (data.progreso) setProgreso(data.progreso);
        setAppState("speaking");
        speak(data.text, { onEnd: () => setAppState(data.finalizada ? "done" : "idle") });
      } catch (err) {
        setSendError(err.message);
        setAppState("idle");
      }
    },
    [sessionId, speak]
  );

  const handleMicClick = useCallback(() => {
    if (appState === "listening") {
      stop(); // el candidato decide cuándo terminó, no una pausa detectada sola
      return;
    }
    if (appState !== "idle") return;

    setAppState("listening");
    start((text) => {
      if (!text) {
        setAppState("idle");
      } else {
        sendToGemini(text);
      }
    });
  }, [appState, start, stop, sendToGemini]);

  if (phase === "setup") {
    return (
      <>
        <CornerMarks />
        <VacanteSetup onStart={handleStart} starting={starting} error={setupError} />
      </>
    );
  }

  const micDisabled =
    !supported || appState === "thinking" || appState === "speaking" || appState === "done";

  const caption =
    appState === "listening"
      ? interimText
        ? `"${interimText}"`
        : "Escuchando…"
      : CAPTION_BY_STATE[appState] || "Toca el micrófono para responder";

  return (
    <div className="voice-page">
      <header className="voice-topbar">
        <span className={`voice-status-dot ${appState === "done" ? "off" : ""}`} />
        <span className="voice-status-label">
          {appState === "done" ? "Entrevista finalizada" : vacante}
        </span>
      </header>

      <ProgressBar actual={progreso.actual} total={progreso.total} />

      <main className="voice-stage">
        <Orb state={appState} />
        {caption && <p className="orb-caption">{caption}</p>}

        {!supported && (
          <div className="warning">
            ⚠️ Tu navegador no soporta reconocimiento de voz. Prueba con Chrome o Edge en escritorio.
          </div>
        )}
        {micError && <div className="warning">{micError}</div>}
        {sendError && <div className="warning">⚠️ {sendError}</div>}
      </main>

      <VoiceBar
        appState={appState}
        onMicClick={handleMicClick}
        micDisabled={micDisabled}
        onClose={handleReset}
      />
    </div>
  );
}
