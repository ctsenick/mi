import { pool } from './db.js';
import crypto from 'crypto';

// In-memory: roomCode -> { sessionId, hostSocketId, players: Map<socketId, player>, status, currentRound, civilianSong, imposterSong, settings }
const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

const CAT_LABELS = { western: '西洋', japanese: '日文', korean: '韓文', chinese: '中文', uncategorized: '未分類' };

async function pickSongs({ category, customSongIds }) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let songs;

  if (category === 'custom') {
    if (!customSongIds || customSongIds.length < 2)
      throw new Error('自訂模式至少需要選擇 2 首歌曲');
    const res = await pool.query(`SELECT * FROM songs WHERE id = ANY($1::int[]) ORDER BY RANDOM()`, [customSongIds]);
    songs = res.rows;
    if (songs.length < 2) throw new Error('自訂歌曲不足 2 首');
  } else {
    const specific = category && category !== 'random';
    const recentQ = specific
      ? `SELECT * FROM songs WHERE (last_played IS NULL OR last_played < $1) AND category=$2 ORDER BY RANDOM() LIMIT 20`
      : `SELECT * FROM songs WHERE last_played IS NULL OR last_played < $1 ORDER BY RANDOM() LIMIT 20`;
    const res = await pool.query(recentQ, specific ? [thirtyDaysAgo, category] : [thirtyDaysAgo]);
    songs = res.rows;

    if (songs.length < 2) {
      const fallQ = specific
        ? `SELECT * FROM songs WHERE category=$1 ORDER BY last_played NULLS FIRST LIMIT 20`
        : `SELECT * FROM songs ORDER BY last_played NULLS FIRST LIMIT 20`;
      const fallback = await pool.query(fallQ, specific ? [category] : []);
      songs = fallback.rows;
    }
    if (songs.length < 2) {
      const label = specific ? `「${CAT_LABELS[category] ?? category}」分類` : '歌庫';
      throw new Error(`${label}歌曲不足 2 首，請先新增歌曲`);
    }
  }

  const civilian = songs[Math.floor(Math.random() * songs.length)];
  const contrasts = songs.filter(
    s => s.id !== civilian.id && Math.abs((s.energy ?? 0.5) - (civilian.energy ?? 0.5)) > 0.3
  );
  const imposterPool = contrasts.length > 0 ? contrasts : songs.filter(s => s.id !== civilian.id);
  const imposter = imposterPool[Math.floor(Math.random() * imposterPool.length)];

  return { civilian, imposter };
}

async function prepareRound(room, code) {
  const { civilian, imposter } = await pickSongs(room.settings);
  const playerList = [...room.players.values()];
  const shuffled = [...playerList].sort(() => Math.random() - 0.5);
  const imposterCount = Math.min(room.settings.imposterCount, playerList.length - 1);

  shuffled.forEach((p, i) => {
    p.role = i < imposterCount ? 'imposter' : 'civilian';
    p.isReady = false;
    p.votesReceived = 0;
    p.votedFor = undefined;
  });

  await pool.query(
    `UPDATE game_sessions SET status='dancing', civilian_song_id=$1, imposter_song_id=$2 WHERE room_code=$3`,
    [civilian.id, room.settings.imposterMode === 'silent' ? null : imposter.id, code]
  );
  await Promise.all(playerList.map(p =>
    pool.query(`UPDATE players SET role=$1, is_ready=FALSE, votes_received=0 WHERE id=$2`, [p.role, p.id])
  ));
  await pool.query(
    `UPDATE songs SET last_played=NOW() WHERE id=ANY($1::int[])`,
    [[civilian.id, imposter?.id].filter(Boolean)]
  );

  room.civilianSong = { id: civilian.id, title: civilian.title, artist: civilian.artist };
  room.imposterSong = room.settings.imposterMode === 'silent'
    ? null
    : { id: imposter.id, title: imposter.title, artist: imposter.artist };
  room.status = 'dancing';

  // startAt is NOT set here — server sets it after the countdown so clients
  // have enough time to fetch + decode the audio before playback begins.
  const playerPayloads = playerList.map(p => ({
    socketId: p.socketId,
    previewUrl: p.role === 'civilian'
      ? civilian.preview_url
      : (room.settings.imposterMode === 'silent' ? null : imposter.preview_url),
  }));

  return { playerPayloads, playerList };
}

export async function createRoom(hostSocketId, hostName) {
  const code = generateRoomCode();
  const result = await pool.query(
    `INSERT INTO game_sessions (room_code, host_socket_id) VALUES ($1, $2) RETURNING id`,
    [code, hostSocketId]
  );
  const sessionId = result.rows[0].id;

  const playerResult = await pool.query(
    `INSERT INTO players (session_id, name, socket_id) VALUES ($1, $2, $3) RETURNING id`,
    [sessionId, hostName, hostSocketId]
  );
  const host = {
    id: playerResult.rows[0].id, name: hostName, socketId: hostSocketId,
    isReady: false, role: null, votesReceived: 0, votedFor: undefined,
  };

  rooms.set(code, {
    sessionId, hostSocketId,
    players: new Map([[hostSocketId, host]]),
    status: 'waiting',
    currentRound: 0,
    civilianSong: null,
    imposterSong: null,
    settings: { imposterCount: 1, imposterMode: 'song', totalRounds: 1, category: 'random', customSongIds: [] },
  });

  return { code, sessionId, player: host };
}

export async function joinRoom(code, socketId, playerName) {
  const room = rooms.get(code);
  if (!room) throw new Error('找不到房間');
  if (room.status !== 'waiting') throw new Error('遊戲已開始');

  const playerResult = await pool.query(
    `INSERT INTO players (session_id, name, socket_id) VALUES ($1, $2, $3) RETURNING id`,
    [room.sessionId, playerName, socketId]
  );
  const player = {
    id: playerResult.rows[0].id, name: playerName, socketId,
    isReady: false, role: null, votesReceived: 0, votedFor: undefined,
  };
  room.players.set(socketId, player);
  return { room, player };
}

export function setReady(code, socketId) {
  const room = rooms.get(code);
  if (!room) return null;
  const player = room.players.get(socketId);
  if (player) player.isReady = true;
  const allReady = [...room.players.values()].every(p => p.isReady);
  return { room, allReady };
}

export function updateSettings(code, socketId, settings) {
  const room = rooms.get(code);
  if (!room || room.hostSocketId !== socketId) return null;
  if (settings.imposterCount !== undefined) room.settings.imposterCount = Math.max(1, settings.imposterCount);
  if (settings.imposterMode !== undefined) room.settings.imposterMode = settings.imposterMode;
  if (settings.totalRounds !== undefined) room.settings.totalRounds = Math.max(1, settings.totalRounds);
  if (settings.category !== undefined) room.settings.category = settings.category;
  if (settings.customSongIds !== undefined) room.settings.customSongIds = settings.customSongIds;
  return room;
}

export async function startGame(code, socketId) {
  const room = rooms.get(code);
  if (!room || room.hostSocketId !== socketId) throw new Error('只有房主可以開始遊戲');
  if (room.players.size < 3) throw new Error('至少需要 3 位玩家才能開始');
  room.currentRound = 1;
  return prepareRound(room, code);
}

export async function nextRound(code, socketId) {
  const room = rooms.get(code);
  if (!room || room.hostSocketId !== socketId) throw new Error('只有房主可以繼續');
  room.currentRound += 1;
  return prepareRound(room, code);
}

export function setVoting(code) {
  const room = rooms.get(code);
  if (room) room.status = 'voting';
}

export function getVotingPlayers(code) {
  const room = rooms.get(code);
  if (!room) return [];
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name }));
}

export function submitVote(code, voterSocketId, targetPlayerId) {
  const room = rooms.get(code);
  if (!room || room.status !== 'voting') return null;
  const voter = room.players.get(voterSocketId);
  if (!voter) return null;

  if (voter.votedFor) {
    const prev = [...room.players.values()].find(p => p.id === voter.votedFor);
    if (prev) prev.votesReceived = Math.max(0, prev.votesReceived - 1);
  }

  voter.votedFor = targetPlayerId;
  const target = [...room.players.values()].find(p => p.id === targetPlayerId);
  if (target) target.votesReceived++;

  const allVoted = [...room.players.values()].every(p => p.votedFor != null);
  return { room, allVoted };
}

export async function resolveResult(code) {
  const room = rooms.get(code);
  if (!room || room.status !== 'voting') return null;

  const playerList = [...room.players.values()];
  const maxVotes = Math.max(...playerList.map(p => p.votesReceived));
  const candidates = playerList.filter(p => p.votesReceived === maxVotes);
  const eliminated = candidates[Math.floor(Math.random() * candidates.length)];

  const civilianWin = eliminated.role === 'imposter';
  room.status = 'ended';
  await pool.query(`UPDATE game_sessions SET status='ended' WHERE room_code=$1`, [code]);

  return {
    eliminated: { id: eliminated.id, name: eliminated.name, role: eliminated.role },
    players: playerList.map(p => ({ id: p.id, name: p.name, role: p.role, votesReceived: p.votesReceived })),
    civilianWin,
    currentRound: room.currentRound,
    totalRounds: room.settings.totalRounds,
    songs: {
      civilian: room.civilianSong
        ? { title: room.civilianSong.title, artist: room.civilianSong.artist }
        : null,
      imposter: room.settings.imposterMode === 'silent'
        ? { title: '（無音樂）', artist: '臥底沉默模式' }
        : (room.imposterSong ? { title: room.imposterSong.title, artist: room.imposterSong.artist } : null),
      imposterMode: room.settings.imposterMode,
    },
  };
}

export async function restartGame(code, socketId) {
  const room = rooms.get(code);
  if (!room || room.hostSocketId !== socketId) return null;
  room.status = 'waiting';
  room.currentRound = 0;
  room.players.forEach(p => {
    p.isReady = false;
    p.role = null;
    p.votesReceived = 0;
    p.votedFor = undefined;
  });
  await pool.query(
    `UPDATE game_sessions SET status='waiting', civilian_song_id=NULL, imposter_song_id=NULL WHERE room_code=$1`,
    [code]
  );
  return room;
}

export function getRoomBySocket(socketId) {
  for (const [code, room] of rooms) {
    if (room.players.has(socketId)) return { code, room };
  }
  return null;
}

export function removePlayer(socketId) {
  const result = getRoomBySocket(socketId);
  if (!result) return null;
  const { code, room } = result;
  const player = room.players.get(socketId);

  // If this player had voted, remove their vote from the target
  if (player?.votedFor != null) {
    const target = [...room.players.values()].find(p => p.id === player.votedFor);
    if (target) target.votesReceived = Math.max(0, target.votesReceived - 1);
  }

  room.players.delete(socketId);
  if (room.players.size === 0) rooms.delete(code);
  return { code, room };
}

export function checkAllVoted(code) {
  const room = rooms.get(code);
  if (!room || room.status !== 'voting') return false;
  const players = [...room.players.values()];
  return players.length > 0 && players.every(p => p.votedFor != null);
}

export function getRoomPlayers(code) {
  const room = rooms.get(code);
  if (!room) return [];
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, isReady: p.isReady,
    isHost: p.socketId === room.hostSocketId,
  }));
}
