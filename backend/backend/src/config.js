import 'dotenv/config';

const env = (key, fallback) => process.env[key] ?? fallback;
const DEFAULT_JWT = 'dev-only-change-me';
const DEFAULT_SERVICE = 'dev-service-token-change-me';

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: Number(env('PORT', 4000)),
  mongoUri: env('MONGO_URI', 'mongodb://localhost:27017/aicte_validation'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET', DEFAULT_JWT),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '8h'),
  serviceToken: env('SERVICE_TOKEN', DEFAULT_SERVICE),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173').split(','),
  aiServiceUrl: env('AI_SERVICE_URL', 'http://localhost:8000'),
  publicApiUrl: env('PUBLIC_API_URL', 'http://localhost:4000'),
  autoApproveColleges: env('AUTO_APPROVE_COLLEGES', 'true') === 'true',
  runWorkerInApi: env('RUN_WORKER_IN_API', 'false') === 'true',
  maxUploadBytes: Number(env('MAX_UPLOAD_MB', 15)) * 1024 * 1024,
  smtp: {
    host: env('SMTP_HOST', ''),
    port: Number(env('SMTP_PORT', 587)),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', 'validation@example.org'),
  },
};

if (config.nodeEnv === 'production' && (config.jwtSecret === DEFAULT_JWT || config.serviceToken === DEFAULT_SERVICE)) {
  throw new Error('Refusing to start in production with default JWT_SECRET or SERVICE_TOKEN');
}
