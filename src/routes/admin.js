import { Router } from 'express';
import { pool } from '../db.js';
import { detectCategory } from '../utils.js';

const router = Router();

const VALID_CATS = ['uncategorized', 'western', 'japanese', 'korean', 'chinese'];

function auth(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'Admin not configured (set ADMIN_PASSWORD)' });
  if (req.headers['x-admin-key'] !== pw) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Verify password
router.post('/login', (req, res) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'Admin not configured' });
  if (req.body.password !== pw) return res.status(401).json({ error: 'Wrong password' });
  res.json({ ok: true });
});

// List songs with optional category filter
router.get('/songs', auth, async (req, res) => {
  const { category } = req.query;
  const specific = category && category !== 'all';
  const q = specific
    ? 'SELECT * FROM songs WHERE category=$1 ORDER BY created_at DESC'
    : 'SELECT * FROM songs ORDER BY created_at DESC';
  const result = await pool.query(q, specific ? [category] : []);
  res.json(result.rows);
});

// Category counts for the filter tabs
router.get('/songs/counts', auth, async (req, res) => {
  const result = await pool.query(
    `SELECT category, COUNT(*)::int AS count FROM songs GROUP BY category ORDER BY count DESC`
  );
  res.json(result.rows);
});

// Update one song's category
router.patch('/songs/:id', auth, async (req, res) => {
  const { category } = req.body;
  if (!VALID_CATS.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  await pool.query('UPDATE songs SET category=$1 WHERE id=$2', [category, req.params.id]);
  res.json({ ok: true });
});

// Delete a song
router.delete('/songs/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM songs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Batch auto-detect categories for all songs
router.post('/songs/auto-detect', auth, async (req, res) => {
  const songs = await pool.query('SELECT id, title, artist, genre FROM songs');
  const updates = songs.rows.map(s => ({
    id: s.id,
    category: detectCategory(s.title, s.artist, s.genre),
  }));
  await Promise.all(updates.map(u =>
    pool.query('UPDATE songs SET category=$1 WHERE id=$2', [u.category, u.id])
  ));
  // Return breakdown
  const counts = updates.reduce((acc, u) => {
    acc[u.category] = (acc[u.category] || 0) + 1;
    return acc;
  }, {});
  res.json({ updated: updates.length, breakdown: counts });
});

export default router;
