import { AppError } from '../errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid id' });
  if (err?.code === 11000) return res.status(409).json({ error: 'Duplicate value', details: err.keyValue });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
