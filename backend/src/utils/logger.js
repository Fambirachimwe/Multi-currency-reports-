/**
 * Minimal structured JSON logger. Never pass secrets, API keys, request
 * bodies or raw sales payloads to it.
 */
function write(level, message, fields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message, fields = {}) => write('info', message, fields),
  warn: (message, fields = {}) => write('warn', message, fields),
  error: (message, fields = {}) => write('error', message, fields),
};
