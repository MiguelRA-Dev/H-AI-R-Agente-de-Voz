import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // host:true = escucha en todas las interfaces de red, no solo localhost,
    // para poder abrir la app desde otro dispositivo de la misma red local.
    host: true,
    proxy: {
      // En desarrollo, Vite corre en su propio puerto (5173) y reenvía
      // cualquier llamada a /api hacia el servidor Express (puerto 3000).
      "/api": "http://localhost:3000",
    },
  },
});
