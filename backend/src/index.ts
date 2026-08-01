import { createApp } from './app';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  console.log(`HireTrack service tickets backend listening on http://${host}:${port}`);
});
