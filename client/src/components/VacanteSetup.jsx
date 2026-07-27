import { useState } from "react";
import { SparkleIcon } from "../icons";

export default function VacanteSetup({ onStart, starting, error }) {
  const [vacante, setVacante] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!vacante.trim() || starting) return;
    onStart(vacante.trim());
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">
          <SparkleIcon width={22} height={22} />
        </div>
        <h1>Asistente Entrevistador</h1>
        <p>Evaluación profesional guiada mediante IA.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="vacante">¿A qué vacante te vas a postular?</label>
          <input
            id="vacante"
            type="text"
            placeholder="Ej: Ingeniería de Sistemas, Marketing Digital…"
            value={vacante}
            onChange={(e) => setVacante(e.target.value)}
            autoFocus
          />

          {error && <div className="setup-error">{error}</div>}

          <button type="submit" className="primary" disabled={starting || !vacante.trim()}>
            {starting ? "Preparando la entrevista…" : "Comenzar entrevista"}
          </button>
        </form>
      </div>
    </div>
  );
}
