import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path or preview host.
  base: './',
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});
