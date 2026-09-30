import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // wrangler dev: the API, with DEV_USER_EMAIL standing in for Access.
    proxy: { "/api": "http://localhost:8787" },
    // src/lib/types.ts imports ../worker/src/api/summary.ts.
    fs: { allow: [".."] },
  },
});
