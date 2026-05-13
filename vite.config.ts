import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { generatorsDataSchema } from './src/data/schemas';

/**
 * Normalize a payload coming from the tuner UI so that every level carries the
 * fields required by the strict zod schema. The UI mostly does this on its own,
 * but if anything (manual paste, older snapshot, future regression) leaves a
 * level without `mode` / `tickIntervalSec`, we patch it from the parent gen so
 * the file we write to disk is always loadable by the simulator.
 */
function normalizeGeneratorsPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const root = payload as { generators?: unknown };
  if (!Array.isArray(root.generators)) return payload;

  for (const gen of root.generators as Array<Record<string, unknown>>) {
    const spawnMode = gen.spawnMode === 'timer' ? 'timer' : 'sacrifice';
    const tickIntervalSec = typeof gen.tickIntervalSec === 'number' ? gen.tickIntervalSec : undefined;
    if (!Array.isArray(gen.levels)) continue;
    for (const lvl of gen.levels as Array<Record<string, unknown>>) {
      if (typeof lvl.mode !== 'string') lvl.mode = spawnMode;
      if (lvl.mode === 'timer' && typeof lvl.tickIntervalSec !== 'number' && tickIntervalSec !== undefined) {
        lvl.tickIntervalSec = tickIntervalSec;
      }
    }
  }
  return payload;
}

function generatorTunerSavePlugin() {
  return {
    name: 'generator-tuner-save',
    configureServer(server) {
      server.middlewares.use('/__generator-tuner/save-generators', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 5_000_000) req.destroy(new Error('Payload too large'));
        });
        req.on('error', err => {
          res.statusCode = 500;
          res.end(err.message);
        });
        req.on('end', () => {
          try {
            const rawParsed = JSON.parse(body);
            const normalized = normalizeGeneratorsPayload(rawParsed);
            const result = generatorsDataSchema.safeParse(normalized);
            if (!result.success) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'schema-validation-failed', issues: result.error.issues }, null, 2));
              return;
            }

            const json = JSON.stringify(result.data, null, 2) + '\n';
            const targets = [
              path.resolve(__dirname, 'src/data/generators.json'),
              path.resolve(__dirname, 'src/data/generators.generated.json'),
            ];
            for (const target of targets) fs.writeFileSync(target, json, 'utf8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, targets }));
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
  plugins: [react(), generatorTunerSavePlugin()],
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
        simulation: path.resolve(__dirname, 'simulation.html')
      }
    }
  }
});
