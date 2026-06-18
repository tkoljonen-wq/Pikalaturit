import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" → suhteelliset polut, jotta PWA toimii GitHub Pagesin
// alipolussa (/Pikalaturit/) ja standalone-tilassa (CLAUDE.md PWA-ohjeet).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
