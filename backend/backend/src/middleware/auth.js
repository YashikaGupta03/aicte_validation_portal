import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { forbidden, unauthorized } from '../errors.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// Loads the user on every request so a disabled account loses access immediately.
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') throw unauthorized('Account is not active');
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden();
  next();
};

// For calls from the AI service and its mock authority lookups
export function serviceAuth(req, _res, next) {
  const given = Buffer.from(String(req.headers['x-service-token'] || ''));
  const expected = Buffer.from(config.serviceToken);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw unauthorized('Bad service token');
  next();
}
