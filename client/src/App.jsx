import { useCallback, useState } from "react";
import VacanteSetup from "./components/VacanteSetup";
import Orb from "./components/Orb";
import ProgressBar from "./components/ProgressBar";
import VoiceBar from "./components/VoiceBar";
import CornerMarks from "./components/CornerMarks";
import ThemeToggle from "./components/ThemeToggle";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import { useTheme } from "./hooks/useTheme";
import { useTabVisibility } from "./hooks/useTabVisibility";
import { bcp47DeIdioma, INSTRUCCIONES_INICIALES } from "./constants";

// Ya no se muestra la transcripción en vivo de lo que dice el candidato (se
// sentía como un chat, no como una conversación de voz) — en su lugar, el
// estado "escuchando" lo comunica el propio orb más una etiqueta chica (ver
// JSX), y acá abajo del orb se deja fija la última pregunta que hizo el
// agente, para que no se le olvide al candidato mientras responde.
const CAPTION_BY_STATE = {
  thinking: "Pensando…",
  speaking: "Hablando…",
  done: "Entrevista finalizada. Gracias por tu tiempo.",
};

// No hay router: cada empresa comparte un link propio con sus candidatos
// (ej. "tuapp.com/e/ingeurbe"), y es lo único que le dice al servidor de qué
// empresa traer las vacantes. Se lee una sola vez al cargar la página.
const RUTA_EMPRESA = /^\/e\/([a-zA-Z0-9-]+)\/?$/;

function leerEmpresaSlug() {
  const match = window.location.pathname.match(RUTA_EMPRESA);
  return match ? match[1] : null;
}

export default function App() {
  const [empresaSlug] = useState(leerEmpresaSlug);
  const [phase, setPhase] = useState("setup"); // setup | interview
  const [sessionId, setSessionId] = useState(null);
  const [vacante, setVacante] = useState("");
  // "es" por defecto mientras no se ha elegido vacante — una vez arranca la
  // entrevista, queda fijo al idioma que el admin configuró para esa vacante.
  const [idioma, setIdioma] = useState("es");
  const [appState, setAppState] = useState("idle"); // idle | listening | thinking | speaking | done
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  // Última pregunta que hizo el agente (lo que dijo data.text/openingText),
  // para dejarla fija debajo del orb mientras el candidato responde.
  const [pregunta, setPregunta] = useState("");
  const [starting, setStarting] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [sendError, setSendError] = useState(null);

  const lang = bcp47DeIdioma(idioma);
  const { error: micError, supported, start, stop } = useSpeechRecognition({ lang });
  const { speak, cancel } = useSpeechSynthesis();
  const { theme, toggleTheme } = useTheme();
  // Cuenta cambios de pestaña/ventana solo durante la entrevista, en silencio,
  // como dato para RRHH (ver useTabVisibility).
  const cambiosPantalla = useTabVisibility(phase === "interview");

  const handleStart = useCallback(
    async (vacanteId, aceptaAvisoPrivacidad, cedula, celular, nombreCompleto) => {
      setStarting(true);
      setSetupError(null);
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vacanteId,
            aceptaAvisoPrivacidad,
            cedula,
            celular,
            nombreCompleto,
            empresaSlug,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo iniciar la entrevista.");

        const idiomaSesion = data.idioma === "en" ? "en" : "es";
        setSessionId(data.sessionId);
        setVacante(data.vacante);
        setIdioma(idiomaSesion);
        setProgreso({ actual: 0, total: data.totalPreguntas || 0 });
        // El servidor manda la pregunta puntual aparte (ver preguntaTexto en
        // /api/session) — si el modelo no la marcó, se cae de vuelta al
        // mensaje completo en vez de quedarse sin nada.
        setPregunta(data.preguntaTexto || data.openingText);
        setPhase("interview");
        setAppState("speaking");
        // idioma recién llegado de la respuesta, no el estado del componente
        // (que todavía no se actualizó a estas alturas — ver nota en el hook).
        const langSesion = bcp47DeIdioma(idiomaSesion);
        // Primero las instrucciones fijas (mic + qué va a pasar), y solo
        // cuando terminan de oírse, el saludo/primera pregunta real que
        // generó Gemini — el candidato nunca ve el mic habilitado hasta que
        // acabaron de hablar las dos cosas (appState se queda en "speaking"
        // durante ambas, ver micDisabled más abajo).
        speak(INSTRUCCIONES_INICIALES[idiomaSesion] || INSTRUCCIONES_INICIALES.es, {
          idioma: idiomaSesion,
          lang: langSesion,
          onEnd: () => {
            speak(data.openingText, {
              idioma: idiomaSesion,
              lang: langSesion,
              onEnd: () => setAppState("idle"),
            });
          },
        });
      } catch (err) {
        setSetupError(err.message);
      } finally {
        setStarting(false);
      }
    },
    [speak, empresaSlug]
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
          body: JSON.stringify({ sessionId, message: text, cambiosPantalla }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error del servidor");

        if (data.progreso) setProgreso(data.progreso);
        setPregunta(data.preguntaTexto || data.text);
        setAppState("speaking");
        speak(data.text, {
          idioma,
          lang,
          onEnd: () => setAppState(data.finalizada ? "done" : "idle"),
        });
      } catch (err) {
        setSendError(err.message);
        setAppState("idle");
      }
    },
    [sessionId, speak, cambiosPantalla, idioma, lang]
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
    if (!empresaSlug) {
      return (
        <>
          <CornerMarks />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="setup-screen">
            <div className="setup-card">
              <h1>Enlace incompleto</h1>
              <p className="vacante-status">
                Este enlace no incluye el de una empresa. Pide a la empresa el enlace de
                postulación que te compartieron.
              </p>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <CornerMarks />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <VacanteSetup
          empresaSlug={empresaSlug}
          onStart={handleStart}
          starting={starting}
          error={setupError}
        />
      </>
    );
  }

  const micDisabled =
    !supported || appState === "thinking" || appState === "speaking" || appState === "done";

  // En listening/idle se deja fija la pregunta que el agente acaba de hacer
  // (en vez de la transcripción en vivo del candidato, que se sentía como un
  // chat) — así no se le olvida mientras responde.
  const caption = CAPTION_BY_STATE[appState] || pregunta || "Toca el micrófono para responder";

  return (
    <div className="voice-page">
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <header className="voice-topbar">
        <span className={`voice-status-dot ${appState === "done" ? "off" : ""}`} />
        <span className="voice-status-label">
          {appState === "done" ? "Entrevista finalizada" : vacante}
        </span>
      </header>

      <ProgressBar actual={progreso.actual} total={progreso.total} />

      <main className="voice-stage">
        <Orb state={appState} />
        {appState === "listening" && (
          <div className="listening-tag">
            <span className="listening-dot" />
            <span>Escuchando</span>
          </div>
        )}
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
