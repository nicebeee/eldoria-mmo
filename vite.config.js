import { defineConfig } from 'vite';

// относительные пути, чтобы сборка работала на GitHub Pages (/eldoria-mmo/)
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
