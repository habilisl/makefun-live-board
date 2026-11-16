// A bounty's leaderboard. Long boards paint only the rows in view.
import {
  abs, bindClock, clearClocks, current, errorBlock, esc, feeLabel, getJson, grouped,
  num, requestNote, taking, usd, view, when,
} from './app.js';

let model = null;
let signature = '';
let listening = false;
let frame = 0;

function rowHeight() {
  return innerWidth <= 800 ? 76 : 56;
}

function scoreText(row, key) {
  const shown = esc(grouped(row.score));
  if (key === 'judge' && Number(row.score) > 1000) {
    return shown + ' <small>' + (Number(row.score) / 10000).toFixed(2) + '%</small>';
  }
  return shown;
}

function rowsOf(board) {
  const column = (board.columns || []).find((item) => !item.hidden);
  const key = (column && column.key) || board.rank_key || 'score';
  const title = (column && column.title) || 'Score';
  const mapRow = (entry, rich) => ({
    rank: entry.rank,
    prize: entry.prize_rank,
    handle: entry.handle || '',
    title: entry.title || '',
    image: rich ? entry.image : '',
    house: !!entry.house,
    baseline: !!entry.baseline,
    eligible: entry.prize_eligible !== false,
    score: rich && entry.display && typeof entry.display === 'object' ? entry.display[key] : entry.display ?? entry.value,
  });
  const top = (board.entries || []).map((entry) => mapRow(entry, true));
  const seen = new Set(top.map((row) => row.rank + '\n' + row.handle));
  const rest = (board.rest || []).map((entry) => mapRow(entry, false)).filter((row) => !seen.has(row.rank + '\n' + row.handle));
  const rows = top.concat(rest);
  rows.sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
  return { rows, key, title };
}

function boardUrl(slug, viewName, phase) {
  const query = new URLSearchParams({ view: viewName || 'performance', ties: 'runs', rows: 'first' });
  if (phase) query.set('phase', phase);
  return '/api/competitions/' + encodeURIComponent(slug) + '/leaderboard?' + query.toString();
}

function paint() {
  if (!model) return;
  const host = document.getElementById('lb');
  const empty = document.getElementById('lbempty');
  if (!host) return;
  const height = rowHeight();
  const query = model.q.trim().toLowerCase();
  const list = query
    ? model.rows.filter((row) => (row.handle + ' ' + row.title).toLowerCase().includes(query))
    : model.rows;
  if (!list.length) {
    host.style.height = '0px';
    host.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.textContent = model.rows.length ? 'No matching entries.' : (model.emptyNote || 'No ranked entries yet.');
    }
    signature = 'empty';
    return;
  }
  if (empty) empty.hidden = true;
  const top = host.getBoundingClientRect().top + scrollY;
  const start = Math.max(0, Math.floor((scrollY - top) / height) - 8);
  const end = Math.min(list.length, Math.ceil((scrollY + innerHeight - top) / height) + 8);
  const next = start + ':' + end + ':' + list.length + ':' + height + ':' + query + ':' + model.key;
  host.style.height = (list.length * height) + 'px';
  if (next === signature && host.childElementCount) return;
  signature = next;
  const pay = model.pay;
  host.innerHTML = list.slice(start, end).map((row, index) => {
    const at = start + index;
    const src = row.image ? abs(row.image) : '';
    const tags = (row.house ? '<i>house</i>' : '') + (row.baseline ? '<i>baseline</i>' : '');
    const prize = row.eligible && pay.get(row.prize) ? usd(pay.get(row.prize)) : '—';
    const face = src
      ? '<img alt="" width="28" height="28" crossorigin="anonymous" src="' + esc(src) + '">'
      : '';
    return '<div class="row" style="transform:translateY(' + (at * height) + 'px);height:' + height + 'px">' +
      '<span class="rk">' + esc(row.rank ?? '—') + '</span>' +
      '<span class="who">' + face + '<span><a href="#/u/' + encodeURIComponent(row.handle) + '">' + esc(row.handle) +
      '</a>' + tags + '</span></span>' +
      '<span class="ttl">' + esc(row.title) + '</span>' +
      '<span class="sc">' + scoreText(row, model.key) + '</span>' +
      '<span class="pz">' + prize + '</span></div>';
  }).join('');
  host.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.remove()));
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint();
  });
}

function onScroll() {
  if (!document.getElementById('lb')) {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    listening = false;
    return;
  }
  schedule();
}

function arm() {
  if (listening) return;
  listening = true;
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
}

function render(slug, board, comp) {
  clearClocks();
  signature = '';
  const shaped = rowsOf(board);
  const rewards = new Map(((comp && comp.rewardsNow) || []).map((reward) => [reward.place, reward.amountUsd]));
  model = {
    id: model && model.id,
    slug,
    q: model && model.slug === slug ? model.q : '',
    rows: shaped.rows,
    key: shaped.key,
    title: shaped.title,
    pay: rewards,
    phase: board.phase && board.phase.key,
    viewName: board.view,
    views: board.views || [],
    phases: (comp && comp.phases) || [],
    emptyNote: board.phase && board.phase.scores_visible === false ? 'Placements are held until results are published.' : 'No ranked entries yet.',
  };
  const live = comp && taking(comp);
  const phaseName = (board.phase && (board.phase.title || board.phase.key)) || '';
  const held = board.phase && board.phase.placements_held;
  const views = model.views.map((name) =>
    '<button type="button" data-view="' + esc(name) + '" aria-pressed="' + (name === model.viewName) + '">' + esc(name) + '</button>').join('');
  const phases = model.phases.map((phase) =>
    '<button type="button" data-phase="' + esc(phase.key) + '" aria-pressed="' + (phase.key === model.phase) + '">' +
    esc(phase.title || phase.key) + '</button>').join('');
  view.innerHTML = '<article class="page">' +
    '<p class="crumb"><a href="#/">Board</a> · <a href="#/bounty/' + encodeURIComponent(slug) + '">' +
    esc((comp && comp.title) || board.competition && board.competition.title || slug) + '</a></p>' +
    '<h1>Leaderboard</h1>' +
    '<p class="dates" id="lbmeta"></p>' +
    (held ? '<p class="note">Places are provisional until results are published.</p>' : '') +
    '<div class="bar"><div class="seg" role="group" aria-label="Phase">' + phases + '</div>' +
    '<div class="seg" role="group" aria-label="View">' + views + '</div>' +
    '<input id="lq" type="search" placeholder="Filter handle or title" aria-label="Filter leaderboard" autocomplete="off" value="' + esc(model.q) + '"></div>' +
    '<div class="lbhead"><span>#</span><span>Account</span><span>Entry</span><span>' + esc(shaped.title) + '</span><span>Pays</span></div>' +
    '<div id="lb"></div><p class="empty" id="lbempty" hidden></p>' +
    '<p class="fine">' + esc(requestNote()) + ' · ' + num(shaped.rows.length) + ' ranked' +
    (comp ? ' · ' + num(comp.submissionCount) + ' entries' : '') + '</p></article>';
  const meta = document.getElementById('lbmeta');
  if (meta && comp) {
    const feeBit = feeLabel(comp) === 'No fee' ? 'No entry fee' : feeLabel(comp) + ' entry fee';
    meta.innerHTML = '<b class="pot">' + usd(comp.potUsd) + '</b> live pot · ' + esc(feeBit) +
      ' · <time id="lbleft"></time> · ' + num(comp.submissionCount) + ' entries · ' + esc(phaseName);
    const left = document.getElementById('lbleft');
    if (live) bindClock(left, comp.deadline);
    else if (left) left.textContent = comp.status === 'resolved' ? 'Ended ' + when(comp.resolvedAt || comp.deadline, false) : 'Closed';
  } else if (meta) {
    meta.textContent = phaseName;
  }
  document.title = ((comp && comp.title) || slug) + ' leaderboard · Live board';
  arm();
  paint();
}

async function reload(id) {
  const slug = model.slug;
  const board = await getJson(boardUrl(slug, model.viewName, model.phase));
  if (!current(id)) return;
  const comp = model.comp;
  model.id = id;
  render(slug, board, comp);
  model.id = id;
  model.comp = comp;
}

export async function show(slug, id) {
  view.innerHTML = '<div class="page"><p class="wait">Loading leaderboard…</p></div>';
  model = { id, slug, q: '' };
  try {
    const [boardResult, compResult] = await Promise.allSettled([
      getJson(boardUrl(slug)),
      getJson('/api/competitions/' + encodeURIComponent(slug) + '?submissions=summary'),
    ]);
    if (!current(id)) return;
    if (boardResult.status === 'rejected') throw boardResult.reason;
    const comp = compResult.status === 'fulfilled' ? compResult.value : null;
    render(slug, boardResult.value, comp);
    model.id = id;
    model.comp = comp;
  } catch (err) {
    if (!current(id)) return;
    view.innerHTML = '<div class="page">' + errorBlock(err, 'the leaderboard') + '</div>';
  } finally {
    if (current(id)) window.__shotReady = true;
  }
}

view.addEventListener('click', (event) => {
  if (!model || !document.getElementById('lb')) return;
  const viewButton = event.target.closest('[data-view]');
  const phaseButton = event.target.closest('[data-phase]');
  if (!viewButton && !phaseButton) return;
  if (viewButton) model.viewName = viewButton.dataset.view;
  if (phaseButton) model.phase = phaseButton.dataset.phase;
  const id = model.id;
  reload(id).catch((err) => {
    if (!current(id)) return;
    const host = document.getElementById('lbempty');
    if (host) {
      host.hidden = false;
      host.textContent = err.message || 'Could not load that view.';
    }
  });
});

view.addEventListener('input', (event) => {
  if (event.target.id !== 'lq' || !model) return;
  model.q = event.target.value;
  signature = '';
  paint();
});
