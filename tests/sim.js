// Headless checks: hand evaluator cases and a long all-bot simulation with chip conservation.
// Run: node tests/sim.js
const P = require('../app/engine.js');
const assert = require('assert');

const c = s => P.RANKS.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const hand = str => str.split(' ').map(c);
const name = str => P.categoryName(P.score(hand(str)));

assert.strictEqual(name('As Ks Qs Js Ts 2d 3c'), 'Straight flush');
assert.strictEqual(name('Ah 2d 3c 4s 5h Kd Kc'), 'Straight');
assert.strictEqual(name('Ah Ad Ac Kd Kc 2s 3s'), 'Full house');
assert.strictEqual(name('Ah Ad Ac Kd Kc Ks 3s'), 'Full house');
assert.strictEqual(name('2h 7h 9h Jh Kh Ad Ac'), 'Flush');
assert.strictEqual(name('9c 9d 9h 9s 2d 3c 4h'), 'Four of a kind');
assert.strictEqual(name('Ah Ad Kc Kd Qc Qs 2h'), 'Two pair');
assert.ok(P.score(hand('Ah Ad Kc Kd Qc 3s 2h')) > P.score(hand('Ah Ad Kc Kd Jc 3s 2h')), 'kicker');
assert.ok(P.score(hand('6h 2d 3c 4s 5h')) > P.score(hand('Ah 2d 3c 4s 5h')), 'six-high beats wheel');

const eqAA = P.equity(hand('Ah Ad'), [], 1, 4000);
assert.ok(eqAA > 0.82 && eqAA < 0.88, 'AA vs 1 random ~85%, got ' + eqAA);

const g = new P.Game();
const total = () => g.players.reduce((s, p) => s + p.chips - p.rebuys * P.START, 0);
let hands = 0, steps = 0;
const t0 = Date.now();
while (hands < 400) {
  const r = g.step(); steps++;
  if (g.street === 'done') {
    hands++;
    assert.strictEqual(total(), P.START * g.N, 'chips conserved at hand ' + g.handNo);
  }
  assert.ok(steps < 200000, 'no infinite loop');
}
const s = g.players.map(p => `${p.name}: acc ${((p.stats.good + p.stats.ok / 2) / p.stats.decisions * 100).toFixed(0)}% lost ${p.stats.evLost.toFixed(0)}bb cm ${p.prof.callMargin.toFixed(2)}`);
console.log(`OK: ${hands} hands, ${g.reviews.length} recent reviews, ${Date.now() - t0} ms\n` + s.join('\n'));
