import { SunIcon, MoonIcon } from "../icons";

export default function ThemeToggle({ theme, onToggle }) {
  const esOscuro = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={esOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={esOscuro ? "Modo claro" : "Modo oscuro"}
    >
      {esOscuro ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
    </button>
  );
}
