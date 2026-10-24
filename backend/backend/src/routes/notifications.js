import { Router } from 'express';
import { Notification } from '../models/Misc.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  res.json(await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean());
});

router.post('/:id/read', async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { readAt: new Date() });
  res.status(204).end();
});

export default router;
