import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: 'src/main/index.ts', 'ingest-worker/index': 'src/ingest-worker/index.ts' },
      },
    },
  },
  preload: {
    build: { outDir: 'dist/preload', rollupOptions: { input: 'src/preload/index.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { outDir: 'dist/renderer', rollupOptions: { input: 'src/renderer/index.html' } },
  },
});
