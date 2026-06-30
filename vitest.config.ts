/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.spec.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    esbuild: {
      jsx: 'automatic',
    },
  },
});