// Public profile: record, payouts, and the bounties an account has entered.
import {
  abs, current, errorBlock, esc, getJson, grouped, num, requestNote, usd, view, when,
} from './app.js';

function enteredLabel(comp) {
  if (!comp) return '';
  if (comp.status === 'resolved') return 'Resolved';
  const deadline = Date.parse(comp.deadline);
  if (comp.status === 'open' && Number.isFinite(deadline) && deadline > Date.now()) return 'Taking entries';
  if (comp.status === 'open') return 'Past deadline';
  return comp.status || '';
}

function solutionRow(entry) {
  const comp = entry.competition || {};
  const href = comp.slug ? '#/bounty/' + encodeURIComponent(comp.slug) : '#/';
  const place = entry.placement ? ' · #' + entry.placement : '';
  const prize = entry.prize_usd ? ' · ' + usd(entry.prize_usd) : '';
  const score = entry.score && entry.score.display != null
    ? ' · ' + (entry.score.column && entry.score.column.title ? entry.score.column.title + ' ' : '') + grouped(entry.score.display)
    : '';
  return '<a class="sol" href="' + href + '"><b>' + esc(entry.title || 'Entry') + '</b><small>' +
    esc(comp.title || comp.slug || 'Bounty') + ' · ' + esc(enteredLabel(comp)) + score + place + prize +
    (entry.entered_at ? ' · ' + esc(when(entry.entered_at, false)) : '') + '</small></a>';
}

function render(profile, shown) {
  const record = profile.record || {};
  const photo = (profile.avatar && (profile.avatar.url_small || profile.avatar.url)) || profile.image;
  const name = profile.display_name || profile.handle;
  const solutions = profile.solutions || [];
  const visible = solutions.slice(0, shown);
  const wallet = profile.wallet && profile.wallet.address;
  const walletHtml = wallet
    ? '<p class="note">Wallet ' + (profile.wallet.explorer_url
      ? '<a href="' + esc(profile.wallet.explorer_url) + '" target="_blank" rel="noopener noreferrer">' + esc(wallet) + '</a>'
      : esc(wallet)) + '</p>'
    : '';
  const payouts = (profile.payouts || []).map((payout) => {
    const comp = payout.competition || {};
    const href = comp.slug ? '#/bounty/' + encodeURIComponent(comp.slug) : '#/';
    return '<li>' + usd(payout.amount_usd) + ' for place ' + esc(payout.place) + ' in <a href="' + href + '">' +
      esc(comp.title || comp.slug || 'a bounty') + '</a> · ' + esc(when(payout.paid_at, false)) + '</li>';
  }).join('');
  view.innerHTML = '<article class="page">' +
    '<p class="crumb"><a href="#/">Board</a></p>' +
    '<div class="person">' +
    (photo ? '<img alt="" width="72" height="72" crossorigin="anonymous" src="' + esc(abs(photo)) + '">' : '') +
    '<div><h1>' + esc(name) + '</h1><p class="note">@' + esc(profile.handle) +
    (profile.joined_at ? ' · joined ' + esc(when(profile.joined_at, false)) : '') +
    (profile.house ? ' · house' : '') + '</p></div></div>' +
    (profile.bio ? '<p class="bio">' + esc(profile.bio) + '</p>' : '') +
    walletHtml +
    '<div class="stats">' +
    '<div><b>' + num(record.competitions_won) + '</b><small>Won</small></div>' +
    '<div><b>' + num(record.podium_finishes) + '</b><small>Podiums</small></div>' +
    '<div><b>' + usd(record.prize_usd) + '</b><small>Paid</small></div>' +
    '<div><b>' + num(record.competitions_entered) + '</b><small>Entered</small></div>' +
    '</div>' +
    (record.best_placement ? '<p class="note">Best place #' + esc(record.best_placement) +
      ' · ' + num(record.competitions_placed) + (Number(record.competitions_placed) === 1 ? ' place' : ' places') + '</p>' : '') +
    (payouts ? '<h2>Payouts</h2><ul class="paylist">' + payouts + '</ul>' : '') +
    '<h2>Entries</h2><div id="sols">' + (visible.map(solutionRow).join('') || '<p class="empty">No public entries.</p>') + '</div>' +
    (solutions.length > shown ? '<p><button type="button" id="more">Show all ' + num(solutions.length) + '</button></p>' : '') +
    '<p class="fine">' + esc(requestNote()) + '</p></article>';
  const image = view.querySelector('.person img');
  if (image) image.addEventListener('error', () => image.remove());
  const more = document.getElementById('more');
  if (more) more.addEventListener('click', () => render(profile, solutions.length));
  document.title = profile.handle + ' · Live board';
}

export async function show(handle, id) {
  view.innerHTML = '<div class="page"><p class="wait">Loading profile…</p></div>';
  try {
    const profile = await getJson('/api/profiles/' + encodeURIComponent(handle));
    if (!current(id)) return;
    render(profile, 40);
  } catch (err) {
    if (!current(id)) return;
    view.innerHTML = '<div class="page">' + errorBlock(err, '@' + handle) + '</div>';
  } finally {
    if (current(id)) window.__shotReady = true;
  }
}
