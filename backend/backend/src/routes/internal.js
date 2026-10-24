import { Router } from 'express';
import { DocumentModel } from '../models/Document.js';
import { Application } from '../models/Application.js';
import { serviceAuth } from '../middleware/auth.js';
import { openGridFsStream } from '../services/files.js';
import { notFound } from '../errors.js';

// Called by the Python AI service only (shared service token). Not exposed to browsers.
const router = Router();
router.use(serviceAuth);

router.get('/files/:id', async (req, res) => {
  const doc = await DocumentModel.findById(req.params.id);
  if (!doc) throw notFound('Document not found');
  res.setHeader('Content-Type', doc.mime);
  openGridFsStream(doc.gridfsId).on('error', () => res.destroy()).pipe(res);
});

router.post('/applications/:id/progress', async (req, res) => {
  const { run, done, total, stage } = req.body || {};
  // Ignore progress from a superseded run
  await Application.updateOne(
    { _id: req.params.id, analysisRun: run, status: 'ai_running' },
    { $set: { 'progress.done': Number(done) || 0, 'progress.total': Number(total) || 5, 'progress.stage': String(stage || '').slice(0, 60) } }
  );
  res.status(204).end();
});

const hamming = (a, b) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
};

// Same document reused across applications: exact (sha256) or visually near-identical (pHash)
router.get('/duplicates', async (req, res) => {
  const { sha256, phash, application_id: exclude } = req.query;
  const base = { active: true, ...(exclude ? { application: { $ne: exclude } } : {}) };
  const mine = exclude ? await Application.findById(exclude, 'owner').lean() : null;
  const describe = async (docs) => {
    const apps = await Application.find({ _id: { $in: docs.map((d) => d.application) } }, 'code owner').lean();
    const info = new Map(apps.map((a) => [String(a._id), a]));
    return docs.map((d) => {
      const other = info.get(String(d.application));
      // sameOwner: a college reusing its own earlier certificate is less alarming than someone else's file
      return { documentId: d._id, applicationId: d.application, applicationCode: other?.code, sameOwner: !!mine && String(other?.owner) === String(mine.owner), key: d.key, filename: d.filename };
    });
  };
  const exact = sha256 ? await DocumentModel.find({ ...base, sha256 }).limit(10).lean() : [];
  let similar = [];
  if (phash && /^[0-9a-f]{16}$/.test(phash)) {
    const candidates = await DocumentModel.find({ ...base, phash: { $ne: null } }, 'application key filename phash sha256').limit(5000).lean();
    similar = candidates.filter((d) => d.sha256 !== sha256 && /^[0-9a-f]{16}$/.test(d.phash) && hamming(phash, d.phash) <= 4).slice(0, 10);
  }
  res.json({ exact: await describe(exact), similar: await describe(similar) });
});

export default router;
