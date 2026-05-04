import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    rollupOptions: {
      external: ["/__singlefile/lib.js"],
    },
  },
  base: "/__singlefile/",
})
