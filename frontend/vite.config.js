import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The dev server proxies /api to the Express backend so the browser only
// ever talks to the application's own API (never to GAAP directly).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.DEV_BACKEND_URL || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': backendUrl,
      },
    },
    test: {
      environment: 'node',
    },
  };
});
