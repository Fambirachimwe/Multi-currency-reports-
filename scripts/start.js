// Production start: runs the Express backend and the built frontend together.
//
// The frontend is served by `vite preview` from frontend/dist (run `npm run build` first).
// It listens on the public PORT (what Render/Railway provide) and proxies /api to the
// backend, which stays on a private port. The browser therefore only ever sees one origin,
// which matches the default VITE_API_BASE_URL of /api/v1.
import { spawn } from 'node:child_process';

const publicPort = process.env.PORT || '4173';
const backendPort = process.env.BACKEND_PORT || '4000';

if (publicPort === backendPort) {
  console.error('PORT and BACKEND_PORT must differ.');
  process.exit(1);
}

const baseEnv = { ...process.env, NODE_ENV: 'production' };

const services = [
  {
    name: 'backend',
    args: ['run', 'start', '-w', '@simbisa/backend'],
    env: { ...baseEnv, PORT: backendPort },
  },
  {
    name: 'frontend',
    args: ['run', 'start', '-w', '@simbisa/frontend'],
    // vite.config.js reads PORT for the preview server and DEV_BACKEND_URL for the /api proxy.
    env: { ...baseEnv, PORT: publicPort, DEV_BACKEND_URL: `http://127.0.0.1:${backendPort}` },
  },
];

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  // Give the backend time to finish its graceful shutdown, then exit.
  setTimeout(() => process.exit(code), 10_000).unref();
}

for (const { name, args, env } of services) {
  const child = spawn('npm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[start] ${name} exited (${signal ?? code}); stopping.`);
    }
    stopAll(code ?? 1);
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      process.exit(code ?? 1);
    }
  });
}

process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));
