import axios from 'axios';
import { config } from '../config.js';

// One REST endpoint, as in the workflow: POST /analyze
export async function callAnalyze(payload) {
  const res = await axios.post(`${config.aiServiceUrl}/analyze`, payload, {
    headers: { 'x-service-token': config.serviceToken },
    timeout: 10 * 60 * 1000,
  });
  return res.data;
}

export async function aiHealth() {
  try {
    const res = await axios.get(`${config.aiServiceUrl}/health`, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
