import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "agente-voz-theme";

function temaInicial() {
  const guardado = localStorage.getItem(STORAGE_KEY);
  if (guardado === "light" || guardado === "dark") return guardado;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Tema claro/oscuro con persistencia en localStorage, aplicado como
// data-theme en <html> para que lo lean todas las variables de index.css.
export function useTheme() {
  const [theme, setTheme] = useState(temaInicial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((actual) => (actual === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
