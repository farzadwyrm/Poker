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

// Strategy layer checks.
assert.strictEqual(P.handKey(hand('Ks As')), 'AKs');
assert.ok(P.handPct(hand('Ah Ad')) < 0.01 && P.handPct(hand('3c 2d')) > 0.99);
assert.deepStrictEqual(P.draws(hand('Ah 5h'), hand('Kh 9h 2c')).names, ['flush draw']);
assert.deepStrictEqual(P.draws(hand('8c 7d'), hand('6h 5s Kc')).names, ['open-ended straight draw']);
assert.deepStrictEqual(P.draws(hand('8c 7d'), hand('5h 4s Kc')).names, ['gutshot straight draw']);
assert.deepStrictEqual(P.draws(hand('Ac Kd'), hand('Qh Js 2c')).names, ['gutshot straight draw']);
const eqRange = P.equity(hand('Qh Qd'), [], 1, 3000, [0.03]);
assert.ok(eqRange > 0.5 && eqRange < 0.61, 'QQ vs top 3% should be ~56%, got ' + eqRange);
console.log('Strategy checks OK');

assert.deepStrictEqual(P.parseCards('As Kd'), hand('As Kd'));
assert.deepStrictEqual(P.parseCards('10h9h'), hand('Th 9h'));
assert.throws(() => P.parseCards('AsAs'));
assert.strictEqual(P.handKey(P.holeFromKey('AJo')), 'AJo');
assert.strictEqual(P.handKey(P.holeFromKey('T9s')), 'T9s');
assert.strictEqual(P.handKey(P.holeFromKey('77')), '77');
console.log('Parsing checks OK');
