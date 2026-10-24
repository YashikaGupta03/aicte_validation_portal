import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Application } from '../models/Application.js';
import { DocumentModel } from '../models/Document.js';
import { Notification } from '../models/Misc.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit, actorOf, sha256 } from '../services/audit.js';
import { detectMime, saveToGridFs } from '../services/files.js';
import { activeDocuments, checklistProgress, loadChecklist } from '../services/checklist.js';
import { nextApplicationCode } from '../models/Counter.js';
import { enqueueAnalysis } from '../queue.js';
import { collegeStatusLabel } from '../services/labels.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';

const router = Router();
router.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
const EDITABLE = ['draft', 'more_info_requested'];

const formSchema = z.object({
  institutionName: z.string().trim().max(200).optional(),
  academicYear: z.string().trim().max(20).optional(),
  address: z.string().trim().max(500).optional(),
  proposedIntake: z.coerce.number().int().min(0).max(100000).optional(),
  previousApprovalRef: z.string().trim().max(100).optional(),
});
const createSchema = z.object({ category: z.string().trim().max(100).default('Extension of Approval'), form: formSchema.default({}) });
const patchSchema = z.object({ form: formSchema });

const toCollegeView = (a) => ({
  id: a._id,
  code: a.code ?? null,
  category: a.category,
  status: a.status,
  statusLabel: collegeStatusLabel(a),
  progress: a.progress,
  form: a.form,
  submittedAt: a.submittedAt,
  savedAt: a.updatedAt,
  infoRequest: a.status === 'more_info_requested' ? a.infoRequest : undefined,
});

async function ownedApplication(req, id) {
  const app = await Application.findById(id);
  if (!app) throw notFound('Application not found');
  if (req.user.role === 'college' && String(app.owner) !== String(req.user._id)) throw forbidden();
  return app;
}

router.post('/', requireRole('college'), validate(createSchema), async (req, res) => {
  const { category, form } = req.validBody;
  await loadChecklist(category); // reject unknown categories early
  const app = await Application.create({ owner: req.user._id, category, form: { institutionName: req.user.institution, ...form } });
  await audit({ actor: actorOf(req.user), action: 'application.draft_created', entityType: 'application', entityId: app._id });
  res.status(201).json(toCollegeView(app));
});

router.get('/mine', requireRole('college'), async (req, res) => {
  const apps = await Application.find({ owner: req.user._id }).sort({ updatedAt: -1 });
  res.json(apps.map(toCollegeView));
});

router.get('/dashboard', requireRole('college'), async (req, res) => {
  const apps = await Application.find({ owner: req.user._id }).sort({ updatedAt: -1 });
  const count = (statuses) => apps.filter((a) => statuses.includes(a.status)).length;
  // Checklist progress for the application the college is currently working on
  const current = apps.find((a) => ['draft', 'more_info_requested'].includes(a.status));
  let progress = null;
  if (current) progress = checklistProgress(await loadChecklist(current.category), await activeDocuments(current._id));
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10).lean();
  res.json({
    stats: {
      drafts: count(['draft']),
      inValidation: count(['submitted', 'ai_running', 'ai_failed', 'ready_for_review', 'under_review']),
      infoRequested: count(['more_info_requested']),
      approved: count(['approved']),
    },
    applications: apps.map(toCollegeView),
    checklistProgress: progress && { applicationId: current._id, ...progress },
    notifications,
  });
});

router.get('/:id', async (req, res) => {
  const app = await ownedApplication(req, req.params.id);
  const [checklist, docs] = await Promise.all([loadChecklist(app.category), activeDocuments(app._id)]);
  res.json({ ...toCollegeView(app), checklist: checklistProgress(checklist, docs) });
});

router.patch('/:id', requireRole('college'), validate(patchSchema), async (req, res) => {
  const app = await ownedApplication(req, req.params.id);
  if (!EDITABLE.includes(app.status)) throw conflict('This application can no longer be edited');
  for (const [k, v] of Object.entries(req.validBody.form)) app.form[k] = v;
  await app.save(); // autosave: bumps updatedAt, which the UI shows as "Draft saved"
  res.json(toCollegeView(app));
});

// ---- uploads -------------------------------------------------------------------------------------------
async function handleUpload(req, res, kind) {
  const app = await ownedApplication(req, req.params.id);
  if (req.user.role !== 'college') throw forbidden();
  if (!EDITABLE.includes(app.status)) throw conflict('Documents can only be changed on a draft or when more information is requested');
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  const checklist = await loadChecklist(app.category);
  const list = kind === 'checklist' ? checklist.documents : checklist.infrastructure;
  if (!list.some((d) => d.key === req.params.key)) throw notFound(`"${req.params.key}" is not in this checklist`);

  const mime = detectMime(req.file.buffer);
  const safeName = req.file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 150);
  const gridfsId = await saveToGridFs(req.file.buffer, { filename: safeName, mime, metadata: { application: String(app._id), key: req.params.key } });

  // Replaced files stay in storage (inactive) so the audit trail still points at what was reviewed
  const replaced = await DocumentModel.updateMany({ application: app._id, kind, key: req.params.key, active: true }, { active: false });
  const doc = await DocumentModel.create({
    application: app._id, kind, key: req.params.key, filename: safeName, mime, size: req.file.size,
    gridfsId, sha256: sha256(req.file.buffer), uploadedBy: req.user._id,
  });
  await audit({
    actor: actorOf(req.user), action: replaced.modifiedCount ? 'document.replaced' : 'document.uploaded',
    entityType: 'document', entityId: doc._id, applicationId: app._id, details: { kind, key: req.params.key, filename: safeName, sha256: doc.sha256 },
  });
  app.updatedAt = new Date();
  await app.save();
  res.status(201).json({ id: doc._id, key: doc.key, kind, filename: doc.filename, size: doc.size, mime });
}

router.put('/:id/documents/:key', requireRole('college'), upload.single('file'), (req, res) => handleUpload(req, res, 'checklist'));
router.put('/:id/infrastructure/:key', requireRole('college'), upload.single('file'), (req, res) => handleUpload(req, res, 'infrastructure'));

// ---- submit --------------------------------------------------------------------------------------------
const REQUIRED_FORM = ['institutionName', 'academicYear', 'address'];

router.post('/:id/submit', requireRole('college'), async (req, res) => {
  const app = await ownedApplication(req, req.params.id);
  const missingForm = REQUIRED_FORM.filter((f) => !app.form[f]);
  if (app.form.proposedIntake == null) missingForm.push('proposedIntake');
  if (missingForm.length) throw badRequest('Complete the application details first', { missingFields: missingForm });

  const checklist = await loadChecklist(app.category);
  const docs = await activeDocuments(app._id);
  const progress = checklistProgress(checklist, docs);
  const code = app.code ?? (await nextApplicationCode());

  // Atomic claim so a double click cannot enqueue two analyses
  const claimed = await Application.findOneAndUpdate(
    { _id: app._id, status: { $in: EDITABLE } },
    {
      $set: {
        status: 'submitted', code, submittedAt: new Date(), missingDocuments: progress.missing.map((m) => m.key),
        progress: { done: 0, total: 5, stage: 'queued' }, analysisError: null,
      },
      $inc: { analysisRun: 1 },
    },
    { new: true }
  );
  if (!claimed) throw conflict('This application has already been submitted');

  await audit({
    actor: actorOf(req.user), action: 'application.submitted', entityType: 'application', entityId: claimed._id, applicationId: claimed._id,
    details: { code, run: claimed.analysisRun, checklistVersion: checklist.version, missingDocuments: progress.missing.map((m) => m.key), flaggedIncomplete: progress.missing.length > 0 },
  });
  try {
    await enqueueAnalysis(claimed._id, claimed.analysisRun);
  } catch (err) {
    claimed.status = 'ai_failed';
    claimed.analysisError = `Could not queue analysis: ${err.message}`;
    await claimed.save();
    throw new AppError(503, 'Application saved but the validation queue is unavailable. An administrator can re-run it.');
  }
  res.status(202).json({ ...toCollegeView(claimed), missingDocuments: progress.missing });
});

export default router;
