// One bounty: live pot, fee, deadline, rewards, description, and rules.
import {
  abs, badge, bindClock, clearClocks, current, errorBlock, esc, feeLabel, getJson,
  hasFee, num, requestNote, taking, usd, view, when,
} from './app.js';

function safeHref(href) {
  let url = String(href || '').replace(/&amp;/g, '&').trim();
  if (url.startsWith('/')) url = 'https://make.fun' + url;
  if (!/^https?:\/\//i.test(url)) return '';
  return esc(url);
}

function markup(raw) {
  let text = esc(raw);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (all, alt, href) => {
    const ok = safeHref(href);
    return ok ? '<img alt="' + alt + '" crossorigin="anonymous" src="' + ok + '">' : alt;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
    const ok = safeHref(href);
    return ok ? '<a href="' + ok + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return text;
}

function inline(raw) {
  return String(raw).split(/(`[^`]+`)/g).map((part, index) => {
    if (index % 2 === 1) return '<code>' + esc(part.slice(1, -1)) + '</code>';
    return markup(part);
  }).join('');
}

export function markdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let index = 0;
  const paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    html += '<p>' + inline(paragraph.join(' ')) + '</p>';
    paragraph.length = 0;
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      flush();
      const buffer = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) buffer.push(lines[index++]);
      if (index < lines.length) index += 1;
      html += '<pre><code>' + esc(buffer.join('\n')) + '</code></pre>';
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length + 1;
      html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      html += '<ul>';
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        html += '<li>' + inline(lines[index].replace(/^\s*[-*]\s+/, '')) + '</li>';
        index += 1;
      }
      html += '</ul>';
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flush();
      html += '<ol>';
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        html += '<li>' + inline(lines[index].replace(/^\s*\d+\.\s+/, '')) + '</li>';
        index += 1;
      }
      html += '</ol>';
      continue;
    }
    if (/^\s*$/.test(line) || /^---+$/.test(line.trim())) {
      flush();
      index += 1;
      continue;
    }
    paragraph.push(line.replace(/^\s*>\s?/, '').trim());
    index += 1;
  }
  flush();
  return html;
}

function rewardRows(item) {
  return (item.rewardsNow || []).map((reward) => {
    const top = reward.place <= 3 ? ' class="top"' : '';
    return '<tr' + top + '><td>' + esc(reward.place) + '</td><td>' + usd(reward.baseUsd) +
      '</td><td>' + usd(reward.feeShareUsd) + '</td><td class="now">' + usd(reward.amountUsd) + '</td></tr>';
  }).join('');
}

function render(item) {
  clearClocks();
  const mark = badge(item);
  const slug = encodeURIComponent(item.slug);
  const live = taking(item);
  const feeNote = hasFee(item)
    ? 'Each entry pays ' + feeLabel(item) + '. Fees collected ' + usd(item.entryFeesUsd || 0) +
      ' from ' + num(item.entryFeePayers || 0) + ' payers sit inside the live pot.'
    : 'No entry fee. The live pot is the posted reward.';
  const phases = (item.phases || []).map((phase) =>
    esc(phase.title || phase.key) + ' ' + esc(when(phase.startsAt)) + ' – ' + esc(when(phase.endsAt))).join(' · ');
  const winner = item.winner && item.winner.handle
    ? '<p class="winner">' + (item.winner.image
      ? '<img alt="" width="28" height="28" crossorigin="anonymous" src="' + esc(abs(item.winner.image)) + '">'
      : '') + '<a href="#/u/' + encodeURIComponent(item.winner.handle) + '">' + esc(item.winner.handle) +
      '</a> took 1st · ' + usd(item.winner.amountUsd) + '</p>'
    : '';
  view.innerHTML = '<article class="page">' +
    '<p class="crumb"><a href="#/">Board</a> · ' + esc(item.category || 'Bounty') +
    ' · <span class="badge ' + mark.cls + '">' + esc(mark.text) + '</span></p>' +
    '<h1>' + esc(item.title) + '</h1>' +
    '<p class="summary">' + esc(item.summary || '') + '</p>' +
    '<div class="stats">' +
    '<div><b>' + usd(item.potUsd) + '</b><small>Live pot</small></div>' +
    '<div><b>' + esc(feeLabel(item)) + '</b><small>Entry fee</small></div>' +
    '<div><b id="left"></b><small>Time left</small></div>' +
    '<div><b>' + num(item.submissionCount) + '</b><small>Entries</small></div>' +
    '</div>' +
    '<p class="dates">Opens ' + esc(when(item.opensAt || item.publishedAt)) +
    ' · Deadline <time datetime="' + esc(item.deadline) + '">' + esc(when(item.deadline)) + '</time>' +
    (item.resolvedAt ? ' · Resolved ' + esc(when(item.resolvedAt)) : '') +
    ' · Status ' + esc(item.status || '—') + '</p>' +
    (phases ? '<p class="dates">' + phases + '</p>' : '') +
    '<p class="jump"><a class="btn" href="#/bounty/' + slug + '/leaderboard">Leaderboard</a></p>' +
    winner +
    '<h2>Rewards</h2>' +
    '<table class="pay"><caption>' + esc(feeNote) + ' Live pot ' + usd(item.potUsd) + '.</caption><thead><tr>' +
    '<th>Place</th><th>Base</th><th>Fee share</th><th>Pays now</th></tr></thead><tbody>' +
    rewardRows(item) + '</tbody></table>' +
    (item.demand ? '<h2>Who it is for</h2><p class="note">' + esc(item.demand) + '</p>' : '') +
    '<h2>Description</h2><div class="prose">' + (markdown(item.description) || '<p>No description published.</p>') + '</div>' +
    '<h2>Rules</h2>' +
    (item.rulesNote && item.rulesNote.text ? '<p class="note">' + esc(item.rulesNote.text) + '</p>' : '') +
    '<div class="prose">' + (markdown(item.rules) || '<p>No rules published.</p>') + '</div>' +
    '<p class="fine">' + esc(requestNote()) + '</p></article>';
  const left = document.getElementById('left');
  if (live) bindClock(left, item.deadline);
  else if (left) left.textContent = item.status === 'resolved' ? 'Ended' : 'Closed';
  document.title = item.title + ' · Live board';
}

export async function show(slug, id) {
  view.innerHTML = '<div class="page"><p class="wait">Loading bounty…</p></div>';
  try {
    const item = await getJson('/api/competitions/' + encodeURIComponent(slug) + '?submissions=summary');
    if (!current(id)) return;
    render(item);
  } catch (err) {
    if (!current(id)) return;
    view.innerHTML = '<div class="page">' + errorBlock(err, slug) + '</div>';
  } finally {
    if (current(id)) window.__shotReady = true;
  }
}
