import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build landet in ../klassik → GitHub Pages liefert es unter alydoc.alysee.de/klassik/ aus.
// Gleiche Domain wie alyDoc → Dropbox-Login (localStorage) und Verschlagwortungs-Index werden geteilt.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../klassik',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5181 },
});
