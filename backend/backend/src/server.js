import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { seedDefaults } from './seed/data.js';

await connectDb();
await seedDefaults();
createApp().listen(config.port, () => console.log(`API listening on :${config.port}`));
if (config.runWorkerInApi) {
  const { startWorker } = await import('./workers/analysisWorker.js');
  startWorker();
}
