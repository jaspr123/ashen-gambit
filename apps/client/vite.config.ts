import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.ASHEN_SERVER ?? 'http://localhost:3001';

/** Copies the single-threaded Stockfish WASM build into /public/engine (no COOP/COEP headers needed). */
function stockfishAssets(): Plugin {
  return {
    name: 'ashen-stockfish',
    buildStart() {
      const src = path.resolve(__dirname, '../../node_modules/stockfish/src');
      const dest = path.resolve(__dirname, 'public/engine');
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        if (!f.startsWith('stockfish-17.1-lite-single')) continue;
        const out = path.join(dest, f.endsWith('.js') ? 'stockfish.js' : 'stockfish.wasm');
        if (!fs.existsSync(out)) fs.copyFileSync(path.join(src, f), out);
      }
    },
  };
}

/** Dev-only: POST /__dev/screenshot {name, data(base64 png)} -> .qa/<name>.png (visual QA). */
function devScreenshots(): Plugin {
  return {
    name: 'ashen-dev-screenshots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/screenshot', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body) as { name: string; data: string };
            const dir = path.resolve(__dirname, '../../.qa');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${name.replace(/[^\w-]/g, '_')}.png`);
            fs.writeFileSync(file, Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
            res.end(file);
          } catch (e) { res.statusCode = 400; res.end(String(e)); }
        });
      });
    },
  };
}

export default defineConfig({
  // Sub-path deploys (e.g. VITE_BASE=/Ashengambit/ behind Traefik) — see src/core/base.ts.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), stockfishAssets(), devScreenshots()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/api': SERVER,
      '/uploads': SERVER,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'],
        },
      },
    },
  },
  optimizeDeps: { include: ['chess.js', 'zod'] },
});
