import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

function autoQuestScoringSavePlugin() {
  return {
    name: 'autoquest-scoring-save',
    configureServer(server) {
      server.middlewares.use('/__autoquest-scoring/save-config', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 100_000) req.destroy(new Error('Payload too large'));
        });
        req.on('error', err => {
          res.statusCode = 500;
          res.end(err.message);
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed || typeof parsed !== 'object') throw new Error('Expected JSON object');
            const target = path.resolve(__dirname, '.context', 'autoquest-scoring-debug-config.json');
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, target }));
          } catch (err) {
            res.statusCode = 500;
            res.end(err instanceof Error ? err.message : String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: '/cult-merge/',
  plugins: [react(), autoQuestScoringSavePlugin()],
  server: {
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
        simulation: path.resolve(__dirname, 'simulation.html'),
        scoringTableDebug: path.resolve(__dirname, 'scoring-table-debug.html')
      }
    }
  }
});
