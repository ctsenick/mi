const CAT_LABELS = { western: '西洋', japanese: '日文', korean: '韓文', chinese: '中文', uncategorized: '未分類' };
const CATS = ['uncategorized', 'western', 'japanese', 'korean', 'chinese'];

let adminKey = sessionStorage.getItem('adminKey') || '';
let allSongs = [];
let currentFilter = 'all';
let searchQuery = '';

// ── Auth ──────────────────────────────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

async function login() {
  const pw = document.getElementById('pw-input').value;
  const res = await fetch('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    adminKey = pw;
    sessionStorage.setItem('adminKey', pw);
    showMain();
  } else {
    document.getElementById('login-error').textContent = '密碼錯誤';
  }
}

function adminFetch(path, opts = {}) {
  return fetch('/admin/api' + path, {
    ...opts,
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}

// ── Init ─────────────────────────────────────────────────────────────────
if (adminKey) {
  // Try auto-login with stored key
  adminFetch('/songs?category=all').then(r => {
    if (r.ok) showMain();
    else sessionStorage.removeItem('adminKey');
  });
}

function showMain() {
  document.getElementById('login-panel').style.display = 'none';
  document.getElementById('main-panel').style.display = 'block';
  loadSongs();
}

// ── Songs ─────────────────────────────────────────────────────────────────
async function loadSongs() {
  const res = await adminFetch('/songs');
  if (!res.ok) return;
  allSongs = await res.json();
  renderTable();
  updateCounts();
}

function filteredSongs() {
  return allSongs.filter(s => {
    const catOk = currentFilter === 'all' || s.category === currentFilter;
    const q = searchQuery.toLowerCase();
    const textOk = !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q);
    return catOk && textOk;
  });
}

function renderTable() {
  const songs = filteredSongs();
  const tbody = document.getElementById('song-table-body');
  const empty = document.getElementById('empty-msg');

  if (!songs.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = songs.map(s => `
    <tr data-id="${s.id}">
      <td class="td-title">
        <div class="song-title">${escHtml(s.title)}</div>
        <div class="song-artist">${escHtml(s.artist)}</div>
      </td>
      <td class="td-genre" title="${escHtml(s.genre || '')}">${escHtml(s.genre || '—')}</td>
      <td>
        <select class="cat-select" data-id="${s.id}">
          ${CATS.map(c => `<option value="${c}" ${s.category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
        </select>
      </td>
      <td>
        <button class="btn btn-danger btn-delete" data-id="${s.id}" style="padding:0.3rem 0.7rem;font-size:0.75rem;">刪除</button>
      </td>
    </tr>
  `).join('');

  // Category selects
  tbody.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      await adminFetch(`/songs/${id}`, { method: 'PATCH', body: { category: sel.value } });
      const song = allSongs.find(s => String(s.id) === String(id));
      if (song) song.category = sel.value;
      updateCounts();
      toast('已更新分類');
    });
  });

  // Delete buttons
  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除這首歌？')) return;
      const id = btn.dataset.id;
      await adminFetch(`/songs/${id}`, { method: 'DELETE' });
      allSongs = allSongs.filter(s => String(s.id) !== String(id));
      renderTable();
      updateCounts();
      toast('已刪除');
    });
  });
}

function updateCounts() {
  const total = filteredSongs().length;
  document.getElementById('song-count-label').textContent = `${total} 首`;
}

// ── Filters ───────────────────────────────────────────────────────────────
document.getElementById('filter-bar').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.cat;
  renderTable();
  updateCounts();
});

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderTable();
  updateCounts();
});

// ── Auto-detect ───────────────────────────────────────────────────────────
document.getElementById('btn-auto-detect').addEventListener('click', async () => {
  const btn = document.getElementById('btn-auto-detect');
  if (!confirm('自動偵測所有歌曲的分類（會覆蓋現有設定），確定嗎？')) return;
  btn.disabled = true;
  btn.textContent = '偵測中…';
  const res = await adminFetch('/songs/auto-detect', { method: 'POST', body: '{}' });
  const data = await res.json();
  btn.disabled = false;
  btn.textContent = '🔍 自動偵測所有分類';
  toast(`完成！共更新 ${data.updated} 首 — 西洋 ${data.breakdown?.western ?? 0} / 日文 ${data.breakdown?.japanese ?? 0} / 韓文 ${data.breakdown?.korean ?? 0} / 中文 ${data.breakdown?.chinese ?? 0} / 未分類 ${data.breakdown?.uncategorized ?? 0}`);
  await loadSongs();
});

// ── Utils ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
