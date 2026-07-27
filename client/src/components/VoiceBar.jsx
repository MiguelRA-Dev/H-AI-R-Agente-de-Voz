import "./VoiceBar.css";
import { MicIcon, CloseIcon } from "../icons";

export default function VoiceBar({ appState, onMicClick, micDisabled, onClose }) {
  return (
    <div className="voice-bar">
      <button
        type="button"
        className={`voice-icon-btn mic ${appState === "listening" ? "active" : ""}`}
        onClick={onMicClick}
        disabled={micDisabled}
        aria-label={appState === "listening" ? "Terminar de hablar" : "Hablar"}
      >
        <MicIcon width={22} height={22} />
      </button>

      <button
        type="button"
        className="voice-icon-btn close"
        onClick={onClose}
        aria-label="Salir de la entrevista"
      >
        <CloseIcon width={18} height={18} />
      </button>
    </div>
  );
}
