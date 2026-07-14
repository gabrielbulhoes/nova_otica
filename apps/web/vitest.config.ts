import { defineConfig, mergeConfig } from 'vitest/config';
// Herda o resolve.alias do app (@planning etc.) — fonte única de configuração.
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
