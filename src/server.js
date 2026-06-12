import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './db.js';
import apiRouter from './routes/api.js';
import adminRouter from './routes/admin.js';
import {
  createRoom, joinRoom, setReady, updateSettings,
  startGame, nextRound, submitVote, resolveResult, restartGame,
  setVoting, removePlayer, getRoomPlayers, getVotingPlayers,
} from './gameManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use('/api', apiRouter);
app.use('/admin/api', adminRouter);
app.get('/admin', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'admin.html')));
app.use(express.static(join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'index.html')));

// Per-room voting timeout handles — cleared when all players vote early
const voteTimers = new Map();

async function runRound(code, playerPayloads) {
  for (let i = 3; i >= 1; i--) {
    io.to(code).emit('countdown', { count: i });
    await new Promise(r => setTimeout(r, 1000));
  }

  // Set startAt AFTER the countdown so clients have ~3s to fetch + decode
  // audio before playback begins (required for iOS Web Audio API flow).
  const startAt = Date.now() + 3000;

  playerPayloads.forEach(({ socketId, previewUrl }) => {
    io.to(socketId).emit('game_start', { previewUrl, startAt, duration: 30000 });
  });

  // After 30s music + 2s buffer → open voting
  setTimeout(() => {
    setVoting(code);
    io.to(code).emit('start_voting', { players: getVotingPlayers(code) });

    // 60s voting timeout → auto-resolve if not all voted yet
    const timer = setTimeout(async () => {
      voteTimers.delete(code);
      const result = await resolveResult(code);
      if (result) io.to(code).emit('reveal_result', result);
    }, 60000);
    voteTimers.set(code, timer);
  }, 32000);
}

io.on('connection', (socket) => {

  socket.on('create_room', async ({ name }, callback) => {
    try {
      const { code, player } = await createRoom(socket.id, name);
      socket.join(code);
      callback({ ok: true, code, playerId: player.id, isHost: true });
      io.to(code).emit('room_update', { players: getRoomPlayers(code), allReady: false });
    } catch (err) {
      callback({ ok: false, error: err.message });
    }
  });

  socket.on('join_room', async ({ code, name }, callback) => {
    const upperCode = code.toUpperCase();
    try {
      const { player } = await joinRoom(upperCode, socket.id, name);
      socket.join(upperCode);
      callback({ ok: true, playerId: player.id, isHost: false });
      io.to(upperCode).emit('room_update', { players: getRoomPlayers(upperCode), allReady: false });
    } catch (err) {
      callback({ ok: false, error: err.message });
    }
  });

  socket.on('player_ready', ({ code }) => {
    const result = setReady(code, socket.id);
    if (!result) return;
    io.to(code).emit('room_update', { players: getRoomPlayers(code), allReady: result.allReady });
  });

  socket.on('update_settings', ({ code, settings }) => {
    updateSettings(code, socket.id, settings);
  });

  socket.on('start_game', async ({ code }, callback) => {
    try {
      const { playerPayloads } = await startGame(code, socket.id);
      callback?.({ ok: true });
      await runRound(code, playerPayloads);
    } catch (err) {
      callback?.({ ok: false, error: err.message });
    }
  });

  socket.on('next_round', async ({ code }) => {
    try {
      // Tell all clients to dismiss result overlay before countdown starts
      io.to(code).emit('round_starting');
      const { playerPayloads } = await nextRound(code, socket.id);
      await runRound(code, playerPayloads);
    } catch (err) {
      console.error('next_round error:', err.message);
    }
  });

  socket.on('submit_vote', ({ code, targetPlayerId }) => {
    const result = submitVote(code, socket.id, targetPlayerId);
    if (!result) return;
    if (result.allVoted) {
      // Cancel the 60s timer since everyone voted
      const timer = voteTimers.get(code);
      if (timer) { clearTimeout(timer); voteTimers.delete(code); }
      resolveResult(code).then(res => {
        if (res) io.to(code).emit('reveal_result', res);
      });
    }
  });

  socket.on('restart_game', async ({ code }) => {
    const timer = voteTimers.get(code);
    if (timer) { clearTimeout(timer); voteTimers.delete(code); }
    await restartGame(code, socket.id);
    io.to(code).emit('go_to_lobby');
    io.to(code).emit('room_update', { players: getRoomPlayers(code), allReady: false });
  });

  socket.on('disconnect', () => {
    const result = removePlayer(socket.id);
    if (result) io.to(result.code).emit('room_update', { players: getRoomPlayers(result.code) });
  });
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
