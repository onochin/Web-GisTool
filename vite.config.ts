import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "github-pages" ? "/Web-GisTool/" : "/",
  test: {
    environment: "node",
  },
}));
