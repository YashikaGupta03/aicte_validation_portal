import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';

export const QUEUE_NAME = 'analysis';

export function redisConnection() {
  // BullMQ requires maxRetriesPerRequest: null on its connections
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

let queue;
export function analysisQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return queue;
}

export async function enqueueAnalysis(applicationId, run) {
  // jobId makes enqueueing idempotent per (application, run)
  return analysisQueue().add('analyze', { applicationId: String(applicationId), run }, { jobId: `${applicationId}-${run}` });
}
