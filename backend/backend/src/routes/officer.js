import { Router } from 'express';
import { z } from 'zod';
import { Application } from '../models/Application.js';
import { DocumentModel } from '../models/Document.js';
import { Flag } from '../models/Flag.js';
import { Verification, VERIFICATION_URGENCY } from '../models/Verification.js';
import { InfraResult } from '../models/InfraResult.js';
import { AuditLog } from '../models/AuditLog.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit, actorOf } from '../services/audit.js';
import { activeDocuments, checklistProgress, loadChecklist } from '../services/checklist.js';
import { notifyUser } from '../services/notify.js';
import { officerStageLabel } from '../services/labels.js';
import { enqueueAnalysis } from '../queue.js';
import { conflict, notFound } from '../errors.js';

const router = Router();
router.use(authenticate, requireRole('officer', 'admin'));

const STAGES = {
  needs_review: ['ready_for_review'],
  in_progress: ['submitted', 'ai_running', 'ai_failed', 'under_review'],
  decided: ['approved', 'rejected', 'more_info_requested'],
};
const UNDECIDED = ['submitted', 'ai_running', 'ai_failed', 'ready_for_review', 'under_review'];
const SEV_ORDER = { high: 0, medium: 1, low: 2 };

// Flags and verifications of each application's current run only (older runs are history)
async function currentResults(apps) {
  const ids = apps.map((a) => a._id);
  const run = new Map(apps.map((a) => [String(a._id), a.analysisRun]));
  const [flags, vers] = await Promise.all([
    Flag.find({ application: { $in: ids } }, 'application run severity review.status').lean(),
    Verification.find({ application: { $in: ids } }, 'application run status').lean(),
  ]);
  return {
    flags: flags.filter((f) => f.run === run.get(String(f.application))),
    verifications: vers.filter((v) => v.run === run.get(String(v.application))),
  };
}

const urgent = (statuses) => VERIFICATION_URGENCY.find((s) => statuses.includes(s)) ?? null;
const tally = (items, key) => items.reduce((acc, i) => ((acc[i[key]] = (acc[i[key]] || 0) + 1), acc), {});

router.get('/queue', async (req, res) => {
  const stage = String(req.query.stage || 'all');
  const filter = stage in STAGES ? { status: { $in: STAGES[stage] } } : { status: { $ne: 'draft' } };
  const [apps, allCounts] = await Promise.all([
    Application.find(filter).populate('owner', 'institution name').sort({ submittedAt: -1 }).limit(200),
    Application.aggregate([{ $match: { status: { $ne: 'draft' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const { flags, verifications } = await currentResults(apps);
  const counts = Object.fromEntries(allCounts.map((c) => [c._id, c.n]));
  const sum = (list) => list.reduce((n, s) => n + (counts[s] || 0), 0);

  res.json({
    tabs: {
      all: sum(Object.values(STAGES).flat()),
      needs_review: sum(STAGES.needs_review),
      in_progress: sum(STAGES.in_progress),
      decided: sum(STAGES.decided),
    },
    rows: apps.map((a) => {
      const f = flags.filter((x) => String(x.application) === String(a._id));
      const v = verifications.filter((x) => String(x.application) === String(a._id));
      return {
        id: a._id, code: a.code, institution: a.form.institutionName || a.owner?.institution, category: a.category,
        submittedAt: a.submittedAt, status: a.status, stageLabel: officerStageLabel(a), progress: a.progress,
        ready: a.status !== 'ai_running' && a.status !== 'submitted',
        flags: { high: f.filter((x) => x.severity === 'high').length, medium: f.filter((x) => x.severity === 'medium').length, low: f.filter((x) => x.severity === 'low').length },
        verification: urgent(v.map((x) => x.status)),
      };
    }),
  });
});

router.get('/stats', async (_req, res) => {
  const apps = await Application.find({ status: { $ne: 'draft' } }, 'status analysisRun').lean();
  const { flags, verifications } = await currentResults(apps);
  const undecided = new Set(apps.filter((a) => UNDECIDED.includes(a.status)).map((a) => String(a._id)));
  const openFlags = flags.filter((f) => undecided.has(String(f.application)) && f.review.status === 'open');
  const high = openFlags.filter((f) => f.severity === 'high');
  const followUp = verifications.filter((v) => undecided.has(String(v.application)) && ['pending', 'source_unavailable', 'manual_review'].includes(v.status));
  const byApp = new Map();
  for (const v of verifications) byApp.set(String(v.application), [...(byApp.get(String(v.application)) || []), v.status]);
  const mostUrgent = [...byApp.values()].map(urgent);

  const n = (s) => apps.filter((a) => a.status === s).length;
  res.json({
    readyForReview: n('ready_for_review'),
    inProgress: { total: n('ai_running') + n('under_review'), aiRunning: n('ai_running'), underReview: n('under_review') },
    openHighFlags: { count: high.length, applications: new Set(high.map((f) => String(f.application))).size },
    verificationsToFollowUp: { count: followUp.length, ...tally(followUp, 'status') },
    openFlagsBySeverity: { high: high.length, medium: openFlags.filter((f) => f.severity === 'medium').length, low: openFlags.filter((f) => f.severity === 'low').length },
    verificationByApplication: Object.fromEntries(VERIFICATION_URGENCY.map((s) => [s, mostUrgent.filter((x) => x === s).length])),
  });
});

router.get('/applications/:id/report', async (req, res) => {
  const app = await Application.findById(req.params.id).populate('owner', 'name institution email');
  if (!app) throw notFound('Application not found');
  const [docs, checklist, flags, verifications, infra, trail] = await Promise.all([
    activeDocuments(app._id),
    loadChecklist(app.category),
    Flag.find({ application: app._id, run: app.analysisRun }).lean(),
    Verification.find({ application: app._id, run: app.analysisRun }).lean(),
    InfraResult.find({ application: app._id, run: app.analysisRun }).lean(),
    AuditLog.find({ applicationId: String(app._id) }).sort({ seq: -1 }).limit(100).lean(),
  ]);
  flags.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  res.json({
    application: { id: app._id, code: app.code, status: app.status, stageLabel: officerStageLabel(app), category: app.category, form: app.form, owner: app.owner, submittedAt: app.submittedAt, run: app.analysisRun, decision: app.decision, analysisError: app.analysisError },
    checklist: checklistProgress(checklist, docs),
    documents: docs.map((d) => ({ id: d._id, kind: d.kind, key: d.key, filename: d.filename, mime: d.mime, extracted: d.extracted })),
    flags, verifications, infrastructure: infra,
    allFlagsReviewed: flags.every((f) => f.review.status !== 'open'),
    auditTrail: trail,
  });
});

const flagReviewSchema = z.object({ status: z.enum(['acknowledged', 'resolved', 'dismissed']), note: z.string().trim().max(1000).optional() });

router.patch('/flags/:flagId', requireRole('officer'), validate(flagReviewSchema), async (req, res) => {
  const flag = await Flag.findById(req.params.flagId);
  if (!flag) throw notFound('Flag not found');
  const app = await Application.findById(flag.application);
  if (flag.run !== app.analysisRun) throw conflict('This flag belongs to an earlier analysis run');
  if (!['ready_for_review', 'under_review'].includes(app.status)) throw conflict('This application is not open for review');
  const { status, note } = req.validBody;
  if (status === 'dismissed' && !note) throw conflict('Add a short note when dismissing a flag');
  flag.review = { status, note, by: req.user._id, at: new Date() };
  await flag.save();
  await audit({ actor: actorOf(req.user), action: `flag.${status}`, entityType: 'flag', entityId: flag._id, applicationId: app._id, details: { type: flag.type, severity: flag.severity, note } });
  res.json(flag);
});

router.post('/applications/:id/start-review', requireRole('officer'), async (req, res) => {
  const app = await Application.findOneAndUpdate({ _id: req.params.id, status: 'ready_for_review' }, { status: 'under_review', assignedOfficer: req.user._id }, { new: true });
  if (!app) throw conflict('Only applications that are ready for review can be started');
  await audit({ actor: actorOf(req.user), action: 'application.review_started', entityType: 'application', entityId: app._id, applicationId: app._id });
  res.json({ id: app._id, status: app.status });
});

const decisionSchema = z.object({
  outcome: z.enum(['approve', 'reject', 'request_info']),
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(2000),
});
const OUTCOME_STATUS = { approve: 'approved', reject: 'rejected', request_info: 'more_info_requested' };

// The only place an application changes to approved / rejected. Humans only: officer role, every flag reviewed.
router.post('/applications/:id/decision', requireRole('officer'), validate(decisionSchema), async (req, res) => {
  const { outcome, reason } = req.validBody;
  const app = await Application.findById(req.params.id);
  if (!app) throw notFound('Application not found');
  if (!['ready_for_review', 'under_review'].includes(app.status)) throw conflict('This application is not open for a decision');
  const open = await Flag.countDocuments({ application: app._id, run: app.analysisRun, 'review.status': 'open' });
  if (open) throw conflict(`Review all flags first: ${open} still open`, { openFlags: open });

  const reviewed = await Flag.countDocuments({ application: app._id, run: app.analysisRun });
  app.status = OUTCOME_STATUS[outcome];
  app.decision = { outcome, reason, by: req.user._id, at: new Date() };
  app.assignedOfficer = req.user._id;
  if (outcome === 'request_info') app.infoRequest = { message: reason, requestedAt: new Date(), requestedBy: req.user._id };
  await app.save();
  await audit({
    actor: actorOf(req.user), action: `decision.${outcome}`, entityType: 'application', entityId: app._id, applicationId: app._id,
    details: { reason, flagsReviewed: reviewed, missingDocuments: app.missingDocuments, run: app.analysisRun },
  });
  const titles = { approve: 'approved', reject: 'not approved', request_info: 'needs more information' };
  await notifyUser(app.owner, { title: `${app.code}: ${titles[outcome]}`, body: reason, applicationId: app._id });
  res.json({ id: app._id, status: app.status });
});

// Re-run the automated checks (for example after the AI service was down)
router.post('/applications/:id/reanalyze', async (req, res) => {
  const app = await Application.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['ai_failed', 'ready_for_review', 'under_review'] } },
    { $set: { status: 'submitted', progress: { done: 0, total: 5, stage: 'queued' }, analysisError: null }, $inc: { analysisRun: 1 } },
    { new: true }
  );
  if (!app) throw conflict('This application cannot be re-analysed in its current state');
  await audit({ actor: actorOf(req.user), action: 'application.reanalysis_requested', entityType: 'application', entityId: app._id, applicationId: app._id, details: { run: app.analysisRun } });
  await enqueueAnalysis(app._id, app.analysisRun);
  res.status(202).json({ id: app._id, run: app.analysisRun });
});

export default router;
