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

router.post('/songs', async (req, res) => {
  const { spotify_id, title, artist, preview_url, genre } = req.body;
  if (!spotify_id || !title || !artist || !preview_url)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    let energy = null;
    try { energy = await getAudioFeatures(spotify_id); } catch (_) {}
    const result = await pool.query(
      `INSERT INTO songs (spotify_id, title, artist, preview_url, genre, energy)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (spotify_id) DO UPDATE SET title=$2, artist=$3, preview_url=$4
       RETURNING *`,
      [spotify_id, title, artist, preview_url, genre ?? null, energy]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
