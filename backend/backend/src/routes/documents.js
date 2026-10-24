import { Router } from 'express';
import { DocumentModel } from '../models/Document.js';
import { Application } from '../models/Application.js';
import { authenticate } from '../middleware/auth.js';
import { openGridFsStream } from '../services/files.js';
import { audit, actorOf } from '../services/audit.js';
import { forbidden, notFound } from '../errors.js';

const router = Router();
router.use(authenticate);

router.get('/:id/file', async (req, res) => {
  const doc = await DocumentModel.findById(req.params.id);
  if (!doc) throw notFound('Document not found');
  const app = await Application.findById(doc.application).lean();
  if (req.user.role === 'college' && String(app.owner) !== String(req.user._id)) throw forbidden();
  if (req.user.role !== 'college') {
    await audit({ actor: actorOf(req.user), action: 'document.viewed', entityType: 'document', entityId: doc._id, applicationId: doc.application, details: { filename: doc.filename } });
  }
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  openGridFsStream(doc.gridfsId).on('error', () => res.destroy()).pipe(res);
});

export default router;
