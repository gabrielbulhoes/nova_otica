import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5180 },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
