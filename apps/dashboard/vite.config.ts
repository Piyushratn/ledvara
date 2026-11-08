import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The API only allows this origin by default (CORS_ORIGINS), so never fall back to another port.
  server: { port: 5173, strictPort: true },
});
