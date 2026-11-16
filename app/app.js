// Live board shell: minute-scoped API cache, hash router, and the bounty board.
const ORIGIN = 'https://make.fun';
const memory = new Map();
const clocks = [];
let generation = 0;
let fetches = 0;

export const view = document.querySelector('#view');

const state = { mode: 'live', sort: 'pot', q: '', cat: '', open: null, done: null };

export function begin() {
  window.__shotReady = false;
  fetches = 0;
  return ++generation;
}

export function current(id) {
  return id === generation;
}

export function requestNote() {
  if (fetches === 0) return 'Cached this minute';
  return fetches === 1 ? '1 request' : fetches + ' requests';
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

export function usd(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

export function grouped(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [whole, frac] = text.split('.');
  const withCommas = Number(whole).toLocaleString('en-US');
  return frac != null ? withCommas + '.' + frac : withCommas;
}

export function when(iso, zone = true) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const text = date.getUTCDate() + ' ' + month + ' ' + date.getUTCFullYear() + ' ' + hh + ':' + mm;
  return zone ? text + ' UTC' : text;
}

export function timeLeft(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'Closed';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return days + 'd ' + hours + 'h';
  if (hours > 0) return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
  return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}

// A bounty past its deadline can still read status "open" until results publish.
export function taking(item) {
  const deadline = Date.parse(item && item.deadline);
  return !!item && item.status === 'open' && Number.isFinite(deadline) && deadline > Date.now();
}

export function feeLabel(item) {
  const n = Number(item && item.entryFeeUsd);
  if (!item || item.entryFeeUsd == null || item.entryFeeUsd === '' || !Number.isFinite(n) || n <= 0) return 'No fee';
  return usd(n);
}

export function hasFee(item) {
  return feeLabel(item) !== 'No fee';
}

export function badge(item) {
  if (!item) return { cls: 'end', text: 'Unknown' };
  if (item.status === 'resolved') return { cls: 'end', text: 'Resolved' };
  if (item.status === 'closed') return { cls: 'end', text: 'Closed' };
  if (taking(item)) return { cls: 'go', text: 'Taking entries' };
  if (item.status === 'open') return { cls: 'wait', text: 'Past deadline' };
  return { cls: 'end', text: item.status || 'Closed' };
}

export function abs(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return ORIGIN + (url.startsWith('/') ? url : '/' + url);
}

export function clearClocks() {
  clocks.length = 0;
}

export function bindClock(node, iso) {
  if (!node) return;
  node.textContent = timeLeft(iso);
  clocks.push({ node, iso });
}

export function errorBlock(err, label) {
  return '<p class="err">Could not load ' + esc(label) + '. ' + esc(err && err.message) +
    ' <button type="button" data-retry>Try again</button></p>';
}

function thisMinute() {
  return Math.floor(Date.now() / 60000);
}

// ETags rotate every minute, so a response cached during this minute is reused.
// Conditional requests are not used: a 304 from make.fun omits
// Access-Control-Allow-Origin and the browser throws it away. The next minute
// refetches with a plain GET.
export async function getJson(path) {
  const hit = memory.get(path);
  if (hit && hit.minute === thisMinute()) return hit.data;
  fetches += 1;
  // no-store: the browser must not replay a cached 304 that arrived without CORS headers.
  const response = await fetch(ORIGIN + path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Not found' : 'HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  memory.set(path, { data, minute: thisMinute() });
  return data;
}

function paintClock() {
  const node = document.getElementById('clock');
  if (!node) return;
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  node.textContent = pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()) + ' UTC';
}

function routePath() {
  let raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!raw) return '/';
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw hash */ }
  if (!raw.startsWith('/')) raw = '/' + raw;
  return raw.replace(/\/+$/, '') || '/';
}

async function collect(path) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const url = path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const body = await getJson(url);
    const batch = Array.isArray(body.items) ? body.items : [];
    for (const item of batch) {
      item.description = undefined;
      item.submissions = undefined;
      item.chat = undefined;
      item.rules = undefined;
      item.resolution = undefined;
      items.push(item);
    }
    cursor = body.next_cursor || '';
    if (!cursor) break;
  }
  return items;
}

function loadOpen() {
  return collect('/api/competitions?status=open&limit=50&activity=times');
}

function loadDone() {
  return collect('/api/competitions?status=resolved&limit=50&activity=times');
}

function shell() {
  clearClocks();
  view.innerHTML = [
    '<div class="wrap">',
    '<div class="hero"><h1><b id="hero-pot">…</b> <span id="hero-word">live</span></h1>',
    '<p class="sub" id="hero-sub">Loading bounties…</p></div>',
    '<div class="bar">',
    '<div class="seg" role="group" aria-label="Which bounties">',
    '<button type="button" data-mode="live">Taking entries</button>',
    '<button type="button" data-mode="wait">Past deadline</button>',
    '<button type="button" data-mode="done">Resolved</button>',
    '</div>',
    '<div class="seg" role="group" aria-label="Sort">',
    '<button type="button" data-sort="pot">Pot</button>',
    '<button type="button" data-sort="end">Ending</button>',
    '<button type="button" data-sort="n">Entries</button>',
    '</div>',
    '<select id="cat" aria-label="Field"><option value="">All fields</option></select>',
    '<input id="q" type="search" placeholder="Filter title" aria-label="Filter by title" autocomplete="off">',
    '</div>',
    '<p class="fine" id="fine"></p>',
    '<table class="board">',
    '<thead><tr>',
    '<th class="pot">Live pot</th><th class="fee">Entry fee</th><th class="time">Time left</th>',
    '<th class="ent">Entries</th><th class="bounty">Bounty</th>',
    '</tr></thead><tbody id="rows"></tbody></table>',
    '<p class="empty" id="empty" hidden>No bounties match. <button type="button" data-reset>Clear filters</button></p>',
    '</div>',
  ].join('');
  const field = document.getElementById('q');
  if (field) field.value = state.q;
}

function categories() {
  const names = new Set();
  for (const item of state.open || []) if (item.category) names.add(item.category);
  for (const item of state.done || []) if (item.category) names.add(item.category);
  return [...names].sort();
}

function syncControls() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  });
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort));
  });
  const select = document.getElementById('cat');
  if (!select) return;
  const options = '<option value="">All fields</option>' + categories().map((name) =>
    '<option value="' + esc(name) + '">' + esc(name) + '</option>').join('');
  if (select.dataset.built !== options) {
    select.innerHTML = options;
    select.dataset.built = options;
  }
  select.value = state.cat;
}

function potOf(item) {
  return Number(item.potUsd ?? item.rewardAmount) || 0;
}

function visibleRows() {
  const source = state.mode === 'done' ? (state.done || []) : (state.open || []);
  const query = state.q.trim().toLowerCase();
  const rows = source.filter((item) => {
    if (state.mode === 'live' && !taking(item)) return false;
    if (state.mode === 'wait' && (item.status !== 'open' || taking(item))) return false;
    if (state.cat && item.category !== state.cat) return false;
    if (!query) return true;
    const hay = ((item.title || '') + ' ' + (item.slug || '') + ' ' + (item.category || '')).toLowerCase();
    return hay.includes(query);
  });
  const end = (item) => Date.parse(item.deadline) || 0;
  rows.sort((a, b) => {
    if (state.sort === 'end') return end(a) - end(b) || potOf(b) - potOf(a);
    if (state.sort === 'n') return (b.submissionCount || 0) - (a.submissionCount || 0) || potOf(b) - potOf(a);
    return potOf(b) - potOf(a) || end(a) - end(b);
  });
  return rows;
}

function timeText(item) {
  if (taking(item)) return timeLeft(item.deadline);
  if (item.status === 'resolved') return when(item.resolvedAt || item.deadline, false);
  return 'Closed';
}

function slip(item) {
  const mark = badge(item);
  const urgent = taking(item) && Date.parse(item.deadline) - Date.now() < 86400000;
  const href = '#/bounty/' + encodeURIComponent(item.slug);
  return '<tr class="' + (hasFee(item) ? 'fee' : '') + '" data-href="' + href + '">' +
    '<td class="pot" data-label="Live pot"><b>' + usd(item.potUsd ?? item.rewardAmount) + '</b></td>' +
    '<td class="' + (hasFee(item) ? 'fee-amt' : '') + '" data-label="Entry fee">' + esc(feeLabel(item)) + '</td>' +
    '<td data-label="Time left"><time class="time' + (urgent ? ' soon' : '') + '" data-clock="' + esc(item.slug) + '">' +
    esc(timeText(item)) + '</time></td>' +
    '<td class="ent" data-label="Entries">' + num(item.submissionCount) + '</td>' +
    '<td class="bounty" data-label="Bounty"><a class="name" href="' + href + '">' + esc(item.title) + '</a>' +
    '<small>' + esc(item.category || 'Bounty') + ' · ' + esc(mark.text) + '</small></td></tr>';
}

function fill() {
  const rowsNode = document.getElementById('rows');
  if (!rowsNode) return;
  clearClocks();
  const rows = visibleRows();
  const entries = rows.reduce((sum, item) => sum + (item.submissionCount || 0), 0);
  const fees = rows.filter(hasFee).length;
  const word = document.getElementById('hero-word');
  document.getElementById('hero-pot').textContent = usd(rows.reduce((sum, item) => sum + potOf(item), 0));
  if (word) word.textContent = state.mode === 'live' ? 'live' : state.mode === 'wait' ? 'waiting' : 'resolved';
  let sub = rows.length + (state.mode === 'live' ? ' taking entries' : state.mode === 'wait' ? ' past the deadline, still listed open' : ' resolved');
  sub += ' · ' + num(entries) + ' submissions';
  if (state.mode === 'live' && fees) sub += ' · ' + fees + (fees === 1 ? ' with a fee' : ' with fees');
  document.getElementById('hero-sub').textContent = sub;
  const fine = document.getElementById('fine');
  // Keep the first count. A later minute's refresh should not rewrite it.
  if (fine && !fine.dataset.set) {
    fine.textContent = requestNote();
    fine.dataset.set = '1';
  }
  rowsNode.innerHTML = rows.map(slip).join('');
  const table = document.querySelector('.board');
  const empty = document.getElementById('empty');
  if (table) table.hidden = rows.length === 0;
  if (empty) empty.hidden = rows.length !== 0;
  for (const item of rows) {
    if (!taking(item)) continue;
    bindClock(rowsNode.querySelector('[data-clock="' + CSS.escape(item.slug) + '"]'), item.deadline);
  }
  syncControls();
}

async function setMode(mode) {
  state.mode = mode;
  syncControls();
  const id = generation;
  if (mode === 'done' && !state.done) {
    const rowsNode = document.getElementById('rows');
    if (rowsNode) rowsNode.innerHTML = '<tr><td colspan="5">Loading resolved bounties…</td></tr>';
    try {
      state.done = await loadDone();
    } catch (err) {
      if (!current(id)) return;
      if (rowsNode) rowsNode.innerHTML = '<tr><td colspan="5">' + esc(err.message) + '</td></tr>';
      return;
    }
  }
  if (!current(id)) return;
  fill();
}

async function openBoard(id) {
  document.title = 'Live board · make.fun';
  if (!document.getElementById('rows')) shell();
  try {
    state.open = await loadOpen();
    if (!current(id)) return;
    if (state.mode === 'done') state.done = await loadDone();
    if (!current(id)) return;
    fill();
  } catch (err) {
    if (!current(id)) return;
    view.innerHTML = '<div class="wrap">' + errorBlock(err, 'the board') + '</div>';
  } finally {
    if (current(id)) window.__shotReady = true;
  }
}

async function go() {
  const id = begin();
  const path = routePath();
  const nav = document.getElementById('nav-board');
  if (path === '/') nav.setAttribute('aria-current', 'page');
  else nav.removeAttribute('aria-current');
  let match;
  if ((match = /^\/bounty\/([^/]+)\/leaderboard$/.exec(path))) {
    const mod = await import('./ranks.js');
    if (!current(id)) return;
    return mod.show(match[1], id);
  }
  if ((match = /^\/bounty\/([^/]+)$/.exec(path))) {
    const mod = await import('./bounty.js');
    if (!current(id)) return;
    return mod.show(match[1], id);
  }
  if ((match = /^\/u\/([^/]+)$/.exec(path))) {
    const mod = await import('./user.js');
    if (!current(id)) return;
    return mod.show(match[1], id);
  }
  if (path !== '/') {
    view.innerHTML = '<div class="wrap"><p class="err">No page at ' + esc(path) + '. <a href="#/">Back to the board</a></p></div>';
    window.__shotReady = true;
    return;
  }
  return openBoard(id);
}

view.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) {
    go();
    return;
  }
  const mode = event.target.closest('[data-mode]');
  if (mode) {
    setMode(mode.dataset.mode);
    return;
  }
  const sort = event.target.closest('[data-sort]');
  if (sort) {
    state.sort = sort.dataset.sort;
    fill();
    return;
  }
  if (event.target.closest('[data-reset]')) {
    state.q = '';
    state.cat = '';
    state.mode = 'live';
    state.sort = 'pot';
    const field = document.getElementById('q');
    if (field) field.value = '';
    setMode('live');
    return;
  }
  if (event.target.closest('a, button, input, select')) return;
  const row = event.target.closest('tr[data-href]');
  if (row) location.hash = row.dataset.href;
});

view.addEventListener('input', (event) => {
  if (event.target.id === 'q') {
    state.q = event.target.value;
    fill();
  } else if (event.target.id === 'cat') {
    state.cat = event.target.value;
    fill();
  }
});

addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const field = document.getElementById('q');
  if (!field) return;
  event.preventDefault();
  field.focus();
});

let seenMinute = thisMinute();
let refreshing = false;

async function refreshBoard() {
  if (refreshing || !document.getElementById('rows')) return;
  refreshing = true;
  const id = generation;
  try {
    const open = await loadOpen();
    if (!current(id) || !document.getElementById('rows')) return;
    state.open = open;
    if (state.mode === 'done') {
      const done = await loadDone();
      if (!current(id) || !document.getElementById('rows')) return;
      state.done = done;
    }
    fill();
  } catch {
    // Keep the board already on screen when a refresh fails.
  } finally {
    refreshing = false;
  }
}

setInterval(() => {
  paintClock();
  for (const clock of clocks) {
    if (clock.node.isConnected) clock.node.textContent = timeLeft(clock.iso);
  }
  const minute = thisMinute();
  if (minute === seenMinute) return;
  seenMinute = minute;
  refreshBoard();
}, 1000);
paintClock();

addEventListener('hashchange', go);
go();
