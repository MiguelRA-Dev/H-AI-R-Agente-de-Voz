import { useEffect, useRef, useState } from "react";

/**
 * Cuenta cuántas veces el candidato salió de la pestaña/ventana durante la
 * entrevista (cambio de pestaña, minimizar, cambiar de app). Es solo una
 * señal para RRHH -no bloquea ni le avisa nada al candidato-, así que se
 * combina con `blur`/`focus` (cubre cambiar de app) y `visibilitychange`
 * (cubre cambiar de pestaña/minimizar) sin contar doble un mismo evento.
 *
 * `activo` prende/apaga el tracking y reinicia el conteo: se usa la fase de
 * la entrevista, para no contar nada durante la pantalla de selección de vacante.
 */
export function useTabVisibility(activo) {
  const [cambiosPantalla, setCambiosPantalla] = useState(0);
  const ausenteRef = useRef(false);

  useEffect(() => {
    if (!activo) return;

    setCambiosPantalla(0);
    ausenteRef.current = false;

    const marcarAusente = () => {
      if (ausenteRef.current) return;
      ausenteRef.current = true;
      setCambiosPantalla((n) => n + 1);
    };
    const marcarPresente = () => {
      ausenteRef.current = false;
    };
    const onVisibilityChange = () => {
      if (document.hidden) marcarAusente();
      else marcarPresente();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", marcarAusente);
    window.addEventListener("focus", marcarPresente);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", marcarAusente);
      window.removeEventListener("focus", marcarPresente);
    };
  }, [activo]);

  return cambiosPantalla;
}
