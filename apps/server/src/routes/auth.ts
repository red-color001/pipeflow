import { Router } from 'express';
import { z } from 'zod';
import {
  findUserById,
  findUserByUsername,
  requireUser,
  signToken,
  updatePassword,
  verifyPassword,
} from '../auth.js';

const router = Router();

const LoginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body' });
    return;
  }
  const { username, password } = parsed.data;
  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  const token = signToken(user.id, user.username);
  res.json({
    token,
    user: { id: user.id, username: user.username, must_change: user.must_change },
  });
});

router.get('/me', requireUser, async (req, res) => {
  const uid = (req as any).user.uid as number;
  const user = await findUserById(uid);
  if (!user) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ id: user.id, username: user.username, must_change: user.must_change });
});

const ChangePwSchema = z.object({
  current: z.string().min(1).max(200),
  next:    z.string().min(4).max(200),
});

router.post('/change-password', requireUser, async (req, res) => {
  const parsed = ChangePwSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body — next must be >= 4 chars' });
    return;
  }
  const uid = (req as any).user.uid as number;
  const user = await findUserById(uid);
  if (!user) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!verifyPassword(parsed.data.current, user.password_hash)) {
    res.status(401).json({ error: 'current password incorrect' });
    return;
  }
  if (parsed.data.current === parsed.data.next) {
    res.status(400).json({ error: 'new password must differ' });
    return;
  }
  await updatePassword(uid, parsed.data.next);
  res.status(204).end();
});

export default router;
