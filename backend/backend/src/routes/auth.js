import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { audit, actorOf } from '../services/audit.js';
import { conflict, forbidden, unauthorized } from '../errors.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  institution: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
  role: z.enum(['college', 'officer', 'admin']),
});

router.post('/signup', limiter, validate(signupSchema), async (req, res) => {
  const { password, ...rest } = req.validBody;
  if (await User.exists({ email: rest.email.toLowerCase() })) throw conflict('An account with this email already exists');
  // Only college accounts can be auto-approved. Officer and admin accounts always wait for an administrator.
  const status = rest.role === 'college' && config.autoApproveColleges ? 'active' : 'pending';
  const user = await User.create({ ...rest, passwordHash: await bcrypt.hash(password, 12), status });
  await audit({
    actor: actorOf(user),
    action: rest.role === 'officer' ? 'officer.verification_requested' : 'user.signup',
    entityType: 'user',
    entityId: user._id,
    details: { role: user.role, status },
  });
  if (status === 'active') return res.status(201).json({ token: signToken(user), user: user.toPublic() });
  const message = rest.role === 'officer'
    ? 'Officer verification request sent to the administrator. You can sign in after your request is approved.'
    : 'Account created. An administrator must approve it before you can sign in.';
  res.status(202).json({ message, user: user.toPublic() });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', limiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.validBody;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    await audit({ action: 'user.login_failed', entityType: 'user', details: { email } });
    throw unauthorized('Incorrect email or password');
  }
  if (user.status === 'pending') throw forbidden('Your account is waiting for administrator approval');
  if (user.status === 'rejected') throw forbidden('Your account verification request was not approved. Contact an administrator for more information.');
  if (user.status !== 'active') throw forbidden('This account is disabled');
  user.lastLoginAt = new Date();
  await user.save();
  await audit({ actor: actorOf(user), action: 'user.login', entityType: 'user', entityId: user._id });
  res.json({ token: signToken(user), user: user.toPublic() });
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user.toPublic() }));

export default router;
