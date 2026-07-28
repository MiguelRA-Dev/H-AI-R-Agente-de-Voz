import { useEffect, useState } from "react";
import { LocationIcon, CheckIcon } from "../icons";

const MODALIDAD_LABEL = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
};

// Las líneas de "requisitos" llegan como texto con guiones, una por renglón
// (ver seed/documentos en Mongo) — se listan como viñetas en la tarjeta abierta.
function lineasDeRequisitos(requisitos) {
  return (requisitos || "")
    .split("\n")
    .map((linea) => linea.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean);
}

// Reemplaza el viejo campo de texto libre: las vacantes vienen del dashboard
// de RRHH (colección "vacantes" en Mongo), el candidato solo elige una.
export default function VacanteSetup({ onStart, starting, error }) {
  const [vacantes, setVacantes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [cedula, setCedula] = useState("");
  const [celular, setCelular] = useState("");
  const [aceptaAviso, setAceptaAviso] = useState(false);
  const [mostrarAviso, setMostrarAviso] = useState(false);

  useEffect(() => {
    let cancelado = false;

    fetch("/api/vacantes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelado) return;
        if (data.error) throw new Error(data.error);
        setVacantes(data.vacantes || []);
      })
      .catch(() => {
        if (!cancelado) setLoadError("No se pudieron cargar las vacantes disponibles.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  const cedulaValida = cedula.trim().length > 0;
  const celularValido = celular.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedId || !cedulaValida || !celularValido || !aceptaAviso || starting) return;
    onStart(selectedId, aceptaAviso, cedula.trim(), celular.trim());
  };

  // Clic en la ya seleccionada = deseleccionarla (se contrae de vuelta).
  const toggleSeleccion = (id) => {
    setSelectedId((actual) => (actual === id ? null : id));
  };

  return (
    <div className="setup-screen">
      <div className="setup-card setup-card--vacantes">
        <h1 className="vacante-heading">Elige la vacante a la que te vas a postular</h1>

        <form onSubmit={handleSubmit}>
          {loading && <p className="vacante-status">Cargando vacantes disponibles…</p>}

          {!loading && loadError && <div className="setup-error">{loadError}</div>}

          {!loading && !loadError && vacantes.length === 0 && (
            <p className="vacante-status">No hay vacantes publicadas por el momento.</p>
          )}

          {!loading && !loadError && vacantes.length > 0 && (
            <div className="vacante-list" role="radiogroup" aria-label="Vacantes disponibles">
              {vacantes.map((v) => {
                const selected = v.id === selectedId;
                const requisitos = selected ? lineasDeRequisitos(v.requisitos) : [];
                return (
                  <button
                    type="button"
                    key={v.id}
                    role="radio"
                    aria-checked={selected}
                    className={`vacante-card${selected ? " selected" : ""}`}
                    onClick={() => toggleSeleccion(v.id)}
                  >
                    <div className="vacante-card-header">
                      <span className="vacante-card-title">{v.titulo}</span>
                      <span className="vacante-card-check">
                        {selected && <CheckIcon width={12} height={12} />}
                      </span>
                    </div>

                    {(v.ubicacion || v.modalidad) && (
                      <div className="vacante-card-meta">
                        {v.ubicacion && (
                          <span className="vacante-pill">
                            <LocationIcon width={11} height={11} />
                            {v.ubicacion}
                          </span>
                        )}
                        {v.modalidad && (
                          <span className="vacante-pill">
                            {MODALIDAD_LABEL[v.modalidad] || v.modalidad}
                          </span>
                        )}
                      </div>
                    )}

                    {v.tipoContrato && <p className="vacante-card-contrato">{v.tipoContrato}</p>}

                    {v.descripcion && (
                      <div className={`vacante-card-desc-wrap${selected ? "" : " clamped"}`}>
                        <p className="vacante-card-desc">{v.descripcion}</p>
                      </div>
                    )}

                    {selected && requisitos.length > 0 && (
                      <div className="vacante-card-requisitos">
                        <span className="vacante-card-requisitos-label">Requisitos</span>
                        <ul>
                          {requisitos.map((linea, i) => (
                            <li key={i}>{linea}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="contacto-fields">
            <div className="contacto-field">
              <label htmlFor="cedula">Cédula</label>
              <input
                id="cedula"
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                placeholder="Ej: 1032456789"
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
              />
            </div>
            <div className="contacto-field">
              <label htmlFor="celular">Celular</label>
              <input
                id="celular"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]+"
                placeholder="Ej: 3001234567"
                value={celular}
                onChange={(e) => setCelular(e.target.value)}
              />
            </div>
          </div>

          <div className="privacy-notice">
            <div className="privacy-row">
              <label className="privacy-checkbox">
                <input
                  type="checkbox"
                  checked={aceptaAviso}
                  onChange={(e) => setAceptaAviso(e.target.checked)}
                />
                <span>
                  He leído y acepto el tratamiento de mis datos personales para este proceso de
                  selección.
                </span>
              </label>
              <button
                type="button"
                className="privacy-link"
                onClick={() => setMostrarAviso((v) => !v)}
              >
                {mostrarAviso ? "Ocultar aviso" : "Ver aviso completo"}
              </button>
            </div>

            <div className={`privacy-details${mostrarAviso ? " open" : ""}`}>
              <p>
                Para esta entrevista, vas a dejar tu cédula y celular en este formulario, y un
                agente de inteligencia artificial te va a pedir tu nombre completo y va a grabar,
                transcribir y evaluar tus respuestas. Estos datos se comparten únicamente con la
                empresa que publicó la vacante, con el fin de evaluar tu postulación y poder
                contactarte. De acuerdo con la Ley 1581 de 2012 (Colombia), puedes solicitar en
                cualquier momento conocer, actualizar, rectificar o eliminar tus datos contactando
                directamente a la empresa.
              </p>
            </div>
          </div>

          {error && <div className="setup-error">{error}</div>}

          <button
            type="submit"
            className="primary"
            disabled={starting || !selectedId || !cedulaValida || !celularValido || !aceptaAviso}
          >
            {starting ? "Preparando la entrevista…" : "Comenzar entrevista"}
          </button>
        </form>
      </div>
    </div>
  );
}
