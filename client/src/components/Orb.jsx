import "./Orb.css";

// Orbe puramente visual: refleja el estado de la conversación (idle / listening /
// thinking / speaking / done). La interacción vive en VoiceBar, no aquí.
export default function Orb({ state }) {
  return (
    <div className={`orb orb-${state}`} aria-hidden="true">
      <span className="orb-glow" />
      <span className="orb-core" />
      <span className="orb-ring" />
    </div>
  );
}
