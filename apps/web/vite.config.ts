import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3333';

// Base path (ex.: "/nova_otica/" no GitHub Pages). Padrão "/".
const BASE = process.env.VITE_BASE ?? '/';

// Módulo puro de planejamento compartilhado com o backend (fonte única).
const PLANNING_MATH = fileURLToPath(
  new URL('../api/src/modules/planning/planning.math.ts', import.meta.url),
);

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: { '@planning': PLANNING_MATH },
  },
  server: {
    port: 5173,
    // Sem fs.allow manual: o Vite já detecta a raiz do monorepo (workspaces)
    // como diretório permitido, o que cobre tanto o módulo compartilhado
    // (@planning em apps/api) quanto os node_modules içados na raiz. Restringir
    // a apps/web quebraria o dev-server (as deps ficam na raiz do repo).
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
});
