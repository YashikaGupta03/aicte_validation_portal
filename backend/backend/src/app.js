import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import auth from './routes/auth.js';
import applications from './routes/applications.js';
import documents from './routes/documents.js';
import notifications from './routes/notifications.js';
import officer from './routes/officer.js';
import admin from './routes/admin.js';
import internal from './routes/internal.js';
import mockAuthority from './routes/mockAuthority.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/applications', applications);
  app.use('/api/documents', documents);
  app.use('/api/notifications', notifications);
  app.use('/api/officer', officer);
  app.use('/api/admin', admin);
  // Service-to-service only (token protected). Do not publish these paths through your public proxy.
  app.use('/internal', internal);
  app.use('/mock-authority', mockAuthority);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
