import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3333';

// Base path (ex.: "/nova_otica/" no GitHub Pages). Padrão "/".
const BASE = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
});
