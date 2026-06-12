const state = {
  socket: null,
  roomCode: null,
  playerId: null,
  isHost: false,
  imposterCount: 1,
  imposterMode: 'song',
  totalRounds: 1,
  audioCtx: null,
  analyser: null,
  library: [],
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// ── Socket ────────────────────────────────────────────────────────────────
function initSocket() {
  state.socket = io();

  state.socket.on('room_update', ({ players, allReady }) => {
    renderPlayerList(players);
    const me = players.find(p => p.id === state.playerId);
    const readyBtn = document.getElementById('btn-ready');
    readyBtn.disabled = me?.isReady ?? false;
    readyBtn.textContent = me?.isReady ? '✅ 已準備' : '✅ 準備';
    const readyCount = players.filter(p => p.isReady).length;
    document.getElementById('room-msg').textContent =
      allReady ? '🎉 全員準備！房主可以開始。' : `等待準備中… (${readyCount}/${players.length})`;
    document.getElementById('btn-start-game').style.display =
      (state.isHost && allReady) ? 'flex' : 'none';
  });

  state.socket.on('countdown', ({ count }) => {
    const overlay = document.getElementById('countdown-overlay');
    const num = document.getElementById('countdown-number');
    overlay.classList.add('active');
    num.textContent = count;
    num.style.animation = 'none';
    num.offsetHeight; // reflow to restart animation
    num.style.animation = '';
  });

  state.socket.on('game_start', async ({ previewUrl, startAt, duration }) => {
    document.getElementById('countdown-overlay').classList.remove('active');
    showScreen('dance');
    await startAudio(previewUrl, startAt, duration);
  });

  state.socket.on('start_voting', ({ players }) => {
    showScreen('vote');
    renderVoteGrid(players);
    startVoteTimer(60);
  });

  // vote_update intentionally not handled — vote counts are hidden during voting

  state.socket.on('reveal_result', (result) => showResult(result));

  state.socket.on('round_starting', () => {
    document.getElementById('result-overlay').classList.remove('active');
    clearInterval(voteTimerInterval);
    const confirmBtn = document.getElementById('btn-confirm-vote');
    confirmBtn.style.display = 'none';
    confirmBtn.disabled = false;
    document.getElementById('vote-msg').textContent = '';
  });

  state.socket.on('go_to_lobby', () => {
    document.getElementById('result-overlay').classList.remove('active');
    showScreen('room');
    document.getElementById('btn-start-game').style.display = 'none';
    const readyBtn = document.getElementById('btn-ready');
    readyBtn.disabled = false;
    readyBtn.textContent = '✅ 準備';
    document.getElementById('room-msg').textContent = '';
  });
}

// ── Lobby ─────────────────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showError('create-error', '請輸入名字');
  if (!state.socket) initSocket();
  state.socket.emit('create_room', { name }, ({ ok, code, playerId, error }) => {
    if (!ok) return showError('create-error', error);
    state.roomCode = code;
    state.playerId = playerId;
    state.isHost = true;
    enterRoom(code);
  });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return showError('join-error', '請輸入名字');
  if (code.length !== 6) return showError('join-error', '請輸入 6 碼房號');
  if (!state.socket) initSocket();
  state.socket.emit('join_room', { code, name }, ({ ok, playerId, error }) => {
    if (!ok) return showError('join-error', error);
    state.roomCode = code;
    state.playerId = playerId;
    state.isHost = false;
    enterRoom(code);
  });
});

async function enterRoom(code) {
  showScreen('room');
  document.getElementById('room-code-display').textContent = code;
  loadLibrary();
  if (state.isHost) document.getElementById('host-settings').style.display = 'block';
  try {
    const url = `${location.origin}?join=${code}`;
    const res = await fetch(`/api/qr?url=${encodeURIComponent(url)}`);
    const { dataUrl } = await res.json();
    document.getElementById('qr-code').src = dataUrl;
  } catch (_) {}
}

// ── Room ──────────────────────────────────────────────────────────────────
function renderPlayerList(players) {
  document.getElementById('player-count').textContent = `${players.length} 人`;
  document.getElementById('player-list').innerHTML = players.map(p => `
    <div class="player-item ${p.isReady ? 'ready' : ''}">
      <div style="display:flex;align-items:center;gap:0.8rem;">
        <div class="player-avatar">${p.name[0].toUpperCase()}</div>
        <span>${p.name}${p.isHost ? ' 👑' : ''}</span>
      </div>
      <span style="font-size:0.8rem;color:${p.isReady ? 'var(--accent)' : 'var(--text-dim)'};">
        ${p.isReady ? '✅' : '⏳'}
      </span>
    </div>
  `).join('');
}

document.getElementById('btn-ready').addEventListener('click', () => {
  state.socket.emit('player_ready', { code: state.roomCode });
  const btn = document.getElementById('btn-ready');
  btn.disabled = true;
  btn.textContent = '✅ 已準備';
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  if (state.library.length < 2) {
    document.getElementById('room-msg').textContent = '⚠️ 歌庫至少需要 2 首歌';
    return;
  }
  document.getElementById('btn-start-game').disabled = true;
  state.socket.emit('start_game', { code: state.roomCode }, (res) => {
    if (res && !res.ok) {
      alert(res.error);
      document.getElementById('btn-start-game').disabled = false;
    }
  });
});

document.getElementById('btn-imposter-minus').addEventListener('click', () => {
  state.imposterCount = Math.max(1, state.imposterCount - 1);
  document.getElementById('imposter-count-display').textContent = state.imposterCount;
  state.socket.emit('update_settings', { code: state.roomCode, settings: { imposterCount: state.imposterCount } });
});

document.getElementById('btn-imposter-plus').addEventListener('click', () => {
  state.imposterCount += 1;
  document.getElementById('imposter-count-display').textContent = state.imposterCount;
  state.socket.emit('update_settings', { code: state.roomCode, settings: { imposterCount: state.imposterCount } });
});

document.getElementById('btn-rounds-minus').addEventListener('click', () => {
  state.totalRounds = Math.max(1, state.totalRounds - 1);
  document.getElementById('rounds-display').textContent = state.totalRounds;
  state.socket.emit('update_settings', { code: state.roomCode, settings: { totalRounds: state.totalRounds } });
});

document.getElementById('btn-rounds-plus').addEventListener('click', () => {
  state.totalRounds += 1;
  document.getElementById('rounds-display').textContent = state.totalRounds;
  state.socket.emit('update_settings', { code: state.roomCode, settings: { totalRounds: state.totalRounds } });
});

document.getElementById('mode-song').addEventListener('click', () => setMode('song'));
document.getElementById('mode-silent').addEventListener('click', () => setMode('silent'));

function setMode(mode) {
  state.imposterMode = mode;
  document.getElementById('mode-song').classList.toggle('active', mode === 'song');
  document.getElementById('mode-silent').classList.toggle('active', mode === 'silent');
  state.socket.emit('update_settings', { code: state.roomCode, settings: { imposterMode: mode } });
}

// ── Song Library ──────────────────────────────────────────────────────────
async function loadLibrary() {
  const res = await fetch('/api/songs');
  state.library = await res.json();
  renderLibrary();
}

function renderLibrary() {
  document.getElementById('library-count').textContent = state.library.length;
  document.getElementById('library-list').innerHTML = state.library.map(s => `
    <div class="library-item">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.title} — ${s.artist}</span>
      <button class="btn-remove" data-id="${s.id}">✕</button>
    </div>
  `).join('');
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/songs/${btn.dataset.id}`, { method: 'DELETE' });
      loadLibrary();
    });
  });
}

document.getElementById('btn-song-search').addEventListener('click', searchSongs);
document.getElementById('song-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchSongs(); });

async function searchSongs() {
  const q = document.getElementById('song-search-input').value.trim();
  if (!q) return;
  const msgEl = document.getElementById('search-msg');
  msgEl.textContent = '搜尋中…';
  document.getElementById('search-results').innerHTML = '';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const tracks = await res.json();
    msgEl.textContent = tracks.length ? '' : '沒有找到有預覽的歌曲，請換個關鍵字';
    document.getElementById('search-results').innerHTML = tracks.map(t => `
      <div class="search-item">
        <div class="search-item-info">
          <div class="search-item-title">${t.title}</div>
          <div class="search-item-artist">${t.artist}</div>
        </div>
        <button class="btn-add" data-track='${JSON.stringify(t).replace(/'/g, "&#39;")}'>加入</button>
      </div>
    `).join('');
    document.querySelectorAll('.btn-add').forEach(btn => {
      btn.addEventListener('click', async () => {
        const track = JSON.parse(btn.dataset.track);
        btn.disabled = true;
        btn.textContent = '…';
        const r = await fetch('/api/songs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(track),
        });
        btn.textContent = r.ok ? '✓' : '✕';
        if (r.ok) loadLibrary();
      });
    });
  } catch (_) {
    msgEl.textContent = '搜尋失敗，請稍後再試';
  }
}

// ── Audio & Visualizer ────────────────────────────────────────────────────
async function startAudio(previewUrl, startAt, duration) {
  // Clean up previous round's audio context
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
    state.analyser = null;
  }

  const delay = Math.max(0, startAt - Date.now());

  if (previewUrl) {
    const audio = new Audio(previewUrl);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 128;
    const source = state.audioCtx.createMediaElementSource(audio);
    source.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);

    await new Promise(r => { audio.oncanplaythrough = r; audio.onerror = r; });
    setTimeout(() => {
      audio.play().catch(() => {});
      startVisualizer(false);
    }, delay);
  } else {
    // Silent imposter: fake visualizer so it's not obvious
    setTimeout(() => startVisualizer(true), delay);
  }

  setTimeout(() => startDanceTimer(duration / 1000), delay);
}

let danceTimerInterval = null;

function startDanceTimer(totalSeconds) {
  if (danceTimerInterval) clearInterval(danceTimerInterval);
  let remaining = totalSeconds;
  const bar = document.getElementById('dance-progress');
  const label = document.getElementById('dance-timer');
  bar.style.width = '100%';
  danceTimerInterval = setInterval(() => {
    remaining--;
    label.textContent = remaining;
    bar.style.width = `${(remaining / totalSeconds) * 100}%`;
    if (remaining <= 0) clearInterval(danceTimerInterval);
  }, 1000);
}

function startVisualizer(silent) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
  resize();
  window.addEventListener('resize', resize);

  const bufferLength = state.analyser ? state.analyser.frequencyBinCount : 64;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.analyser && !silent) {
      state.analyser.getByteFrequencyData(dataArray);
    } else {
      for (let i = 0; i < bufferLength; i++) dataArray[i] = Math.random() * 30 + 10;
    }

    const barW = (canvas.width / bufferLength) * 1.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barH = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = `hsl(${(i / bufferLength) * 60 + 40}, 100%, 60%)`;
      ctx.fillRect(x, canvas.height - barH, Math.max(barW - 2, 1), barH);
      x += barW;
    }
  }
  draw();
}

// ── Voting ────────────────────────────────────────────────────────────────
let voteTimerInterval = null;

function renderVoteGrid(players) {
  document.getElementById('vote-grid').innerHTML = players.map(p => `
    <div class="vote-card ${p.id === state.playerId ? 'self' : ''}" data-id="${p.id}">
      <div class="player-avatar">${p.name[0].toUpperCase()}</div>
      <span class="vote-name">${p.name}${p.id === state.playerId ? ' (你)' : ''}</span>
    </div>
  `).join('');

  document.querySelectorAll('.vote-card:not(.self)').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.socket.emit('submit_vote', { code: state.roomCode, targetPlayerId: parseInt(card.dataset.id) });
      document.getElementById('btn-confirm-vote').style.display = 'flex';
    });
  });
}

function startVoteTimer(seconds) {
  let remaining = seconds;
  const label = document.getElementById('vote-timer-label');
  voteTimerInterval = setInterval(() => {
    remaining--;
    label.textContent = `誰是臥底？（剩餘 ${remaining} 秒）`;
    if (remaining <= 0) {
      clearInterval(voteTimerInterval);
      label.textContent = '時間到！等待結果…';
    }
  }, 1000);
}

document.getElementById('btn-confirm-vote').addEventListener('click', () => {
  document.getElementById('btn-confirm-vote').disabled = true;
  document.getElementById('vote-msg').textContent = '已確認，等待其他玩家…';
});

// ── Result ────────────────────────────────────────────────────────────────
function showResult({ eliminated, players, civilianWin, currentRound, totalRounds, songs }) {
  clearInterval(voteTimerInterval);
  const overlay = document.getElementById('result-overlay');
  overlay.classList.add('active');

  // Round indicator
  document.getElementById('result-round').textContent =
    totalRounds > 1 ? `第 ${currentRound} / ${totalRounds} 局` : '';

  const title = document.getElementById('result-title');
  title.textContent = civilianWin ? '🎉 平民勝利！' : '🕵️ 臥底勝利！';
  title.style.color = civilianWin ? 'var(--accent)' : 'var(--accent2)';

  document.getElementById('result-eliminated').textContent =
    `被淘汰：${eliminated.name}（${eliminated.role === 'imposter' ? '果然是臥底！' : '是平民...'}）`;

  // Song reveal
  if (songs) {
    document.getElementById('result-songs').innerHTML = `
      <div class="songs-reveal">
        <div class="song-row">
          <span class="song-label">👥 平民聽</span>
          <span class="song-info">${songs.civilian?.title ?? '—'} — ${songs.civilian?.artist ?? '—'}</span>
        </div>
        <div class="song-row">
          <span class="song-label">🕵️ 臥底聽</span>
          <span class="song-info">${songs.imposter?.title ?? '—'} — ${songs.imposter?.artist ?? '—'}</span>
        </div>
      </div>
    `;
  }

  // Players with roles + vote counts
  document.getElementById('result-players').innerHTML = players.map(p => `
    <div class="result-player-row">
      <span>${p.name}</span>
      <span class="role-badge ${p.role}">${p.role === 'imposter' ? '🕵️ 臥底' : '👥 平民'}</span>
      <span style="color:var(--text-dim);font-size:0.85rem;">${p.votesReceived} 票</span>
    </div>
  `).join('');

  // Buttons — only host controls flow
  const nextRoundBtn = document.getElementById('btn-result-next-round');
  const restartBtn = document.getElementById('btn-result-restart');

  nextRoundBtn.style.display = 'none';
  restartBtn.style.display = 'none';

  if (state.isHost) {
    const hasMoreRounds = currentRound < totalRounds;
    if (hasMoreRounds) {
      nextRoundBtn.style.display = 'flex';
      nextRoundBtn.textContent = `▶ 下一局（${currentRound + 1}/${totalRounds}）`;
      nextRoundBtn.disabled = false;
      nextRoundBtn.onclick = () => {
        nextRoundBtn.disabled = true;
        state.socket.emit('next_round', { code: state.roomCode });
      };
    } else {
      restartBtn.style.display = 'flex';
      restartBtn.onclick = () => { state.socket.emit('restart_game', { code: state.roomCode }); };
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
const urlCode = new URLSearchParams(location.search).get('join');
if (urlCode) {
  document.getElementById('join-code').value = urlCode.toUpperCase();
  document.getElementById('join-name').focus();
}
