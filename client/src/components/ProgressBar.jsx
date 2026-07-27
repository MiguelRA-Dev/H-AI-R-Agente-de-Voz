import "./ProgressBar.css";

export default function ProgressBar({ actual, total }) {
  if (!total) return null;
  const pct = Math.min(100, Math.round((actual / total) * 100));

  return (
    <div
      className="progress-wrap"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progreso de la entrevista"
    >
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-label">
        {Math.min(actual, total)} / {total}
      </span>
    </div>
  );
}