import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Checklist } from '../models/Checklist.js';
import { AuditLog } from '../models/AuditLog.js';
import { Source, SourceRecord } from '../models/Misc.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit, actorOf, verifyChain } from '../services/audit.js';
import { analysisQueue } from '../queue.js';
import { aiHealth } from '../services/aiClient.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { notifyUser } from '../services/notify.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/overview', async (_req, res) => {
  const [active, pending, sources, ai] = await Promise.all([User.countDocuments({ status: 'active' }), User.countDocuments({ status: 'pending' }), Source.find().lean(), aiHealth()]);
  let queue = { running: false, jobsInQueue: 0 };
  try {
    const c = await Promise.race([analysisQueue().getJobCounts('waiting', 'active', 'delayed'), new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), 3000))]);
    queue = { running: true, jobsInQueue: c.waiting + c.active + c.delayed, ...c };
  } catch { /* Redis unreachable: reported as not running */ }
  res.json({
    activeUsers: active,
    pendingSignups: pending,
    jobsInQueue: queue.jobsInQueue,
    sourcesReachable: { reachable: sources.filter((s) => s.available).length, total: sources.length },
    health: {
      aiService: ai ? 'Running' : 'Unavailable',
      jobQueue: queue.running ? 'Running' : 'Unavailable',
      sources: sources.map((s) => ({ key: s.key, name: s.name, status: s.available ? 'Reachable' : 'Unavailable' })),
    },
  });
});

// ---- users ---------------------------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const users = await User.find(filter).sort({ status: 1, createdAt: -1 }).limit(500);
  res.json(users.map((u) => u.toPublic()));
});

router.post('/users/:id/approve', async (req, res) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { status: 'active' }, { new: true });
  if (!user) throw conflict('User not found or not pending');
  await audit({ actor: actorOf(req.user), action: 'user.approved', entityType: 'user', entityId: user._id, details: { role: user.role } });
  await notifyUser(user._id, { title: 'Your account is approved', body: 'You can now sign in to the Approval Validation Platform.' });
  res.json(user.toPublic());
});

router.post('/users/:id/reject', async (req, res) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { status: 'rejected' }, { new: true });
  if (!user) throw conflict('User not found or not pending');
  await audit({ actor: actorOf(req.user), action: 'user.rejected', entityType: 'user', entityId: user._id, details: { role: user.role } });
  await notifyUser(user._id, { title: 'Your registration was not approved', body: 'An administrator declined this account request.' });
  res.json(user.toPublic());
});

const userPatch = z.object({ role: z.enum(['college', 'officer', 'admin']).optional(), status: z.enum(['active', 'disabled']).optional(), designation: z.string().trim().max(100).optional() });
router.patch('/users/:id', validate(userPatch), async (req, res) => {
  if (String(req.params.id) === String(req.user._id) && (req.validBody.role || req.validBody.status === 'disabled')) throw badRequest('You cannot change your own role or disable yourself');
  const user = await User.findByIdAndUpdate(req.params.id, req.validBody, { new: true });
  if (!user) throw notFound('User not found');
  await audit({ actor: actorOf(req.user), action: 'user.updated', entityType: 'user', entityId: user._id, details: req.validBody });
  res.json(user.toPublic());
});

// ---- checklists and rules ------------------------------------------------------------------------------
router.get('/checklists', async (_req, res) => res.json(await Checklist.find().lean()));
router.get('/checklists/:category', async (req, res) => {
  const c = await Checklist.findOne({ category: req.params.category }).lean();
  if (!c) throw notFound('Checklist not found');
  res.json(c);
});

const checklistSchema = z.object({
  documents: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().min(2).max(120), description: z.string().max(300).optional(),
    required: z.boolean().default(true), rule: z.string().max(300).optional(), mustBeValidOnSubmission: z.boolean().default(false),
    requiredFields: z.array(z.string().regex(/^[a-z_]+$/)).default([]), referencePattern: z.string().max(200).optional(),
  })).min(1).max(40),
  infrastructure: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().min(2).max(120), requirement: z.string().min(5).max(500) })).max(40).default([]),
});

router.put('/checklists/:category', validate(checklistSchema), async (req, res) => {
  for (const d of req.validBody.documents) {
    if (d.referencePattern) { try { new RegExp(d.referencePattern); } catch { throw badRequest(`Invalid referencePattern for ${d.key}`); } }
  }
  const existing = await Checklist.findOne({ category: req.params.category });
  const version = (existing?.version ?? 0) + 1;
  const updated = await Checklist.findOneAndUpdate({ category: req.params.category }, { ...req.validBody, version, updatedBy: req.user._id }, { upsert: true, new: true });
  await audit({ actor: actorOf(req.user), action: 'checklist.updated', entityType: 'checklist', entityId: updated._id, details: { category: req.params.category, version, documents: updated.documents.map((d) => d.key) } });
  res.json(updated);
});

// ---- verification sources ------------------------------------------------------------------------------
router.get('/sources', async (_req, res) => {
  const [sources, counts] = await Promise.all([Source.find().lean(), SourceRecord.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }])]);
  const n = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(sources.map((s) => ({ ...s, records: n[s.key] || 0 })));
});

router.patch('/sources/:key', validate(z.object({ available: z.boolean() })), async (req, res) => {
  const s = await Source.findOneAndUpdate({ key: req.params.key }, { available: req.validBody.available }, { new: true });
  if (!s) throw notFound('Source not found');
  await audit({ actor: actorOf(req.user), action: 'source.availability_changed', entityType: 'source', entityId: s.key, details: { available: s.available } });
  res.json(s);
});

// ---- audit trail (read only) ---------------------------------------------------------------------------
router.get('/audit', async (req, res) => {
  const filter = {};
  if (req.query.applicationId) filter.applicationId = String(req.query.applicationId);
  if (req.query.action) filter.action = String(req.query.action);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ seq: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  res.json({ total, page, limit, items });
});

router.get('/audit/verify', async (_req, res) => res.json(await verifyChain()));

export default router;
