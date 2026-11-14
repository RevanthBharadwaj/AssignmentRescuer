import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // PDF.js's worker is an ES module.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist',
  },
});
