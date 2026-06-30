import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // The official `mupdf` package ships an Emscripten WASM binary at
    // `mupdf-wasm.wasm` next to `mupdf-wasm.js` and locates it via
    // `new URL("mupdf-wasm.wasm", import.meta.url)`. Pre-bundling rewrites
    // import.meta.url and breaks that lookup, so we exclude it from
    // dependency optimization and let Vite serve it as-is.
    exclude: ['mupdf'],
  },
  // Pre-built MuPDF wasm/js are too large for Vite's size warning to be useful.
  build: {
    chunkSizeWarningLimit: 16384,
  },
  assetsInclude: ['**/*.wasm'],
})
