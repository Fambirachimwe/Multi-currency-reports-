import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// The dev server proxies /api to the Express backend so the browser only
// ever talks to the application's own API (never to GAAP directly).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.DEV_BACKEND_URL || 'http://localhost:4000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': backendUrl,
      },
    },
    // Production: `vite preview` serves frontend/dist on the host's public PORT and proxies
    // /api to the backend. allowedHosts is open because the public
    // hostname (e.g. *.onrender.com) is not known at build time.
    preview: {
      host: true,
      port: Number(env.PORT) || 4173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': backendUrl,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      css: false,
    },
  };
});
