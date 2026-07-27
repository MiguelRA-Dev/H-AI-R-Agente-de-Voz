import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // En desarrollo, Vite corre en su propio puerto (5173) y reenvía
      // cualquier llamada a /api hacia el servidor Express (puerto 3000).
      "/api": "http://localhost:3000",
    },
  },
});
