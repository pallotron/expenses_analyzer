import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Node for now: the payslip parser is pure text handling. This becomes
    // "jsdom" (with the react plugin and testing-library setup files, as in
    // audax_tracker) once there are components to render.
    environment: "node",
  },
});
