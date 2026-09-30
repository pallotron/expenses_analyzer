import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Node by default: the payslip parser is pure text handling. Component
    // tests opt in with a `@vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
