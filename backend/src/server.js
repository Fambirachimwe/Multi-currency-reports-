import { createApp } from './app.js';

const DEFAULT_PORT = 4000;

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
const app = createApp();

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
