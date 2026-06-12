import { Router } from 'express';
import { searchTracks, getAudioFeatures } from '../music.js';
import { pool } from '../db.js';
import QRCode from 'qrcode';

const router = Router();

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  try {
    const tracks = await searchTracks(q);
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VALID_CATEGORIES = ['uncategorized', 'western', 'japanese', 'korean', 'chinese'];

router.post('/songs', async (req, res) => {
  const { spotify_id, title, artist, preview_url, genre, category } = req.body;
  if (!spotify_id || !title || !artist || !preview_url)
    return res.status(400).json({ error: 'Missing required fields' });
  const cat = VALID_CATEGORIES.includes(category) ? category : 'uncategorized';
  try {
    let energy = null;
    try { energy = await getAudioFeatures(spotify_id); } catch (_) {}
    const result = await pool.query(
      `INSERT INTO songs (spotify_id, title, artist, preview_url, genre, energy, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (spotify_id) DO UPDATE SET title=$2, artist=$3, preview_url=$4, category=$7
       RETURNING *`,
      [spotify_id, title, artist, preview_url, genre ?? null, energy, cat]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/songs/:id', async (req, res) => {
  const { category } = req.body;
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  await pool.query(`UPDATE songs SET category=$1 WHERE id=$2`, [category, req.params.id]);
  res.json({ ok: true });
});

router.get('/songs', async (req, res) => {
  const result = await pool.query(`SELECT * FROM songs ORDER BY created_at DESC`);
  res.json(result.rows);
});

router.delete('/songs/:id', async (req, res) => {
  await pool.query(`DELETE FROM songs WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

router.get('/qr', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
