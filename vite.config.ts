import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: '/cult-merge/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true
  },
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, './src/app'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@domain': path.resolve(__dirname, './src/domain'),
      '@store': path.resolve(__dirname, './src/store'),
      '@data': path.resolve(__dirname, './src/data'),
      '@infra': path.resolve(__dirname, './src/infra'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@simulation': path.resolve(__dirname, './src/simulation')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        simulation: path.resolve(__dirname, 'simulation.html')
      }
    }
  }
});
