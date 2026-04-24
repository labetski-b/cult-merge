import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Supplement tsconfigPaths for files in src/simulation/ (excluded from tsconfig.app.json)
      '@simulation': path.resolve(__dirname, './src/simulation'),
      '@domain': path.resolve(__dirname, './src/domain'),
      '@data': path.resolve(__dirname, './src/data'),
      '@infra': path.resolve(__dirname, './src/infra'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
