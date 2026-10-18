// Coach quality audit. Plays all-bot hands, re-checks every coach recommendation against
// invariants, measures how often advice flips on a re-run, and compares the coach's equity
// estimate with the true equity against the opponents' actual cards (hidden from the coach;
// used here only to measure calibration).
// Run: node tests/coach_audit.js [hands=150]
const P = require('../app/engine.js');

const HANDS = Number(process.argv[2]) || 150;
const game = new P.Game();
game.learning = false;
const issues = {};
const flag = (kind, r, extra) => {
  (issues[kind] = issues[kind] || []).push({ hand: r.view.hand, street: r.view.street, pos: r.view.pos, hole: r.view.hole.map(P.cardText).join(''), board: r.view.board.map(P.cardText).join(''), pot: r.view.pot, toCall: r.view.toCall, rec: r.rec, eq: +r.eq.toFixed(3), reason: r.reason, ...extra });
};

let spots = 0, flips = 0, calib = { n: 0, est: 0, act: 0 }, calibFacing = { n: 0, est: 0, act: 0 };
const freshCoach = new P.Coach();

function trueEquity(seat, iters) {
  const me = game.players[seat];
  const opp = game.players.filter(q => q !== me && !q.folded);
  const known = new Set(me.hole.concat(game.board, ...opp.map(q => q.hole)));
  const deck = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  let won = 0;
  for (let i = 0; i < iters; i++) {
    const b = game.board.slice();
    const d = deck.slice();
    while (b.length < 5) b.push(d.splice(Math.floor(Math.random() * d.length), 1)[0]);
    const mine = P.score(me.hole.concat(b));
    let ties = 0, lost = false;
    for (const q of opp) { const s = P.score(q.hole.concat(b)); if (s > mine) { lost = true; break; } if (s === mine) ties++; }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / iters;
}

while (game.handNo < HANDS || game.street !== 'done') {
  if (game.street === 'idle' || game.street === 'done' || game.toAct === -1) { game.step(); continue; }
  const seat = game.toAct;
  const v = game.coachView(seat);
  const adv = game.coach.advise(v);
  const r = { view: v, rec: adv.rec, eq: adv.eq, reason: adv.reason };
  spots++;

  // Consistency: a fresh coach (no cache) should usually agree.
  const adv2 = freshCoach.advise(v);
  freshCoach.cache.clear();
  if (adv2.rec !== adv.rec) { flips++; flag('flip on re-run', r, { rec2: adv2.rec, eq2: +adv2.eq.toFixed(3) }); }

  // Invariants.
  if (adv.rec === 'fold' && v.toCall === 0) flag('fold when check is free', r);
  if (adv.rec === 'raise' && (adv.raiseTo <= v.currentBet || adv.raiseTo > v.maxTo)) flag('bad raise size', r, { raiseTo: adv.raiseTo });
  if (/NaN|undefined/.test(adv.reason)) flag('broken text', r);
  if (v.street === 'preflop') {
    const p = P.handPct(v.hole);
    const raises = v.actions.filter(a => a.street === 'preflop' && a.type === 'raise').length;
    if (p <= 0.03 && adv.rec === 'fold' && raises < 3) flag('premium folded preflop', r);
    if (p > 0.5 && adv.rec === 'raise') flag('trash raised preflop', r);
  } else {
    const made = Math.floor(P.score(v.hole.concat(v.board)) / 1048576);
    if (adv.rec === 'call' && adv.eq < adv.required - 1e-9) flag('call below price', r, { required: +adv.required.toFixed(3) });
    if (adv.rec === 'fold' && adv.eq >= adv.required) flag('fold above price', r, { required: +adv.required.toFixed(3) });
    const boardMade = Math.floor(P.score(v.board) / 1048576);
    if (adv.rec === 'fold' && made >= 2 && boardMade === 0 && v.toCall <= v.pot / 2) flag('real two pair+ folded to small bet', r);
    if (adv.rec === 'raise' && adv.eq < 0.2 && !['cbet', 'draws'].includes(adv.concept)) flag('weak hand bets for value', r);
    // Calibration against the real (hidden) hands.
    const act = trueEquity(seat, 300);
    calib.n++; calib.est += adv.eq; calib.act += act;
    if (v.toCall > 0) {
      calibFacing.n++; calibFacing.est += adv.eq; calibFacing.act += act;
      if (adv.eq - act > 0.35) flag('equity badly overestimated facing a bet', r, { actual: +act.toFixed(3) });
    }
  }
  game.act(seat, game.botDecide(seat));
}

const avg = c => c.n ? `est ${(c.est / c.n * 100).toFixed(1)}% vs actual ${(c.act / c.n * 100).toFixed(1)}% (n=${c.n})` : 'n/a';
console.log(`Coach audit: ${HANDS} hands, ${spots} decisions`);
console.log(`Advice flip rate on re-run: ${(flips / spots * 100).toFixed(1)}%`);
console.log(`Postflop equity calibration, all spots: ${avg(calib)}`);
console.log(`Postflop equity calibration, facing a bet: ${avg(calibFacing)}`);
for (const [k, list] of Object.entries(issues).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}: ${list.length}`);
  for (const x of list.slice(0, 3)) console.log('  ' + JSON.stringify(x));
}
