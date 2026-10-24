import { Router } from 'express';
import { Source, SourceRecord } from '../models/Misc.js';
import { serviceAuth } from '../middleware/auth.js';

// Stand-in for issuing authorities (NAAC, NBA, AICTE records, university, fire dept).
// Real integrations replace this router; the AI service only sees the response shape.
// GET /mock-authority/:source?ref=<reference number>
const router = Router();
router.use(serviceAuth);

router.get('/:source', async (req, res) => {
  const source = await Source.findOne({ key: req.params.source }).lean();
  if (!source) return res.status(404).json({ error: 'Unknown source' });
  if (!source.available) return res.status(503).json({ error: 'Source unavailable' });
  const ref = String(req.query.ref || '').trim();
  if (!ref) return res.status(400).json({ error: 'ref is required' });
  const record = await SourceRecord.findOne({ source: source.key, ref }).lean();
  if (!record) return res.status(404).json({ error: 'No record found', found: false });
  res.json({ source: source.key, reference: record.ref, found: true, ...record.data });
});

export default router;
