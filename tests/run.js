// Run with: node tests/run.js
'use strict';
const assert = require('assert');
const PE = require('../app/engine.js');
const Coach = require('../app/coach.js');
const Bots = require('../app/bots.js');

const cards = (s) => s.split(' ').map(PE.parseCard);
const ev = (s) => PE.evaluate(cards(s));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('hand categories', () => {
  const cases = [
    ['As Ks Qs Js Ts 2d 3c', 'Straight flush'],
    ['9h 9d 9s 9c 2d 3c 4h', 'Four of a kind'],
    ['9h 9d 9s 2c 2d 3c 4h', 'Full house'],
    ['9h 9d 9s 2c 2d 2h 4h', 'Full house'],
    ['Ah 9h 5h 3h 2h Kd Kc', 'Flush'],
    ['Ah 2d 3c 4s 5h Kd Qc', 'Straight'],
    ['7h 7d 7s Kc 2d 3c 9h', 'Three of a kind'],
    ['7h 7d Ks Kc 2d 2c 9h', 'Two pair'],
    ['7h 7d As Kc 2d 3c 9h', 'Pair'],
    ['7h 8d As Kc 2d 3c Jh', 'High card'],
  ];
  for (const [h, name] of cases) assert.strictEqual(PE.handName(ev(h)), name, h);
});

test('hand ordering and kickers', () => {
  assert(ev('Ah 2d 3c 4s 5h') < ev('2h 3d 4c 5s 6h'), 'wheel is the lowest straight');
  assert(ev('Ah Ad Kc 7s 2h') > ev('Ah Ad Qc Js Th'), 'pair kicker');
  assert(ev('Kh Kd 7c 7s Ah') > ev('Kh Kd 7c 7s Qh'), 'two pair kicker');
  assert(ev('Kh Kd Qc Qs 7h 7c 2d') === ev('Kh Kd Qc Qs 7h 6c 2d'), 'third pair does not count');
  assert(ev('As Ks Qs Js Ts') > ev('Ks Qs Js Ts 9s'));
});

test('side pots', () => {
  const p = (total, folded = false) => ({ total, folded });
  const pots = PE.computePots([p(100), p(300), p(300), p(50, true)]);
  assert.deepStrictEqual(pots, [{ amount: 350, eligible: [0, 1, 2] }, { amount: 400, eligible: [1, 2] }]);
});

test('coach equity sanity', () => {
  const aa = Coach.equity(cards('As Ad'), [], [0], 3000);
  const sevenTwo = Coach.equity(cards('7c 2d'), [], [0], 3000);
  assert(aa > 0.8 && aa < 0.89, 'AA vs random ~85%: ' + aa);
  assert(sevenTwo > 0.28 && sevenTwo < 0.4, '72o vs random ~35%: ' + sevenTwo);
  assert.strictEqual(Coach.equity(cards('As Ad'), cards('Ah Ac 2d 7h 9s'), [0], 200), 1);
});

function makeTable() {
  const t = new PE.Table();
  for (const s of Bots.STYLES) t.addPlayer({ name: s.name, params: Object.assign({}, s.params) });
  return t;
}

test('coachView never exposes other players’ hole cards', () => {
  const t = makeTable();
  t.startHand();
  const v = t.coachView(t.toAct);
  const mine = new Set(v.hole);
  const json = JSON.stringify(v);
  for (const [i, p] of t.players.entries()) {
    if (i === t.toAct) continue;
    assert(!p.hole.some((c) => mine.has(c)));
  }
  assert(!/hole/.test(JSON.stringify(v.opponents)), 'opponents carry no cards');
  assert(json.length > 0);
});

test('500 bot hands conserve chips and stay legal', () => {
  const t = makeTable();
  let decisions = 0;
  for (let h = 0; h < 500; h++) {
    assert(t.startHand());
    let guard = 0;
    while (!t.handOver) {
      assert(guard++ < 200, 'hand did not terminate');
      const seat = t.toAct;
      const a = Coach.analyze(t.coachView(seat), { iters: 60 });
      const d = Bots.decide(a, t.players[seat].params);
      const g = Coach.grade(a, d);
      assert(['Good', 'Okay', 'Mistake', 'Blunder'].includes(g.grade));
      Bots.learn(t.players[seat], g);
      t.act(seat, d.type, d.amount);
      decisions++;
    }
    const chips = t.players.reduce((s, p) => s + p.stack, 0);
    const bought = t.players.reduce((s, p) => s + (1 + p.rebuys) * t.startStack, 0);
    assert.strictEqual(chips, bought, `chips not conserved after hand ${h}`);
    assert(t.players.every((p) => p.stack >= 0));
  }
  assert(decisions > 1000);
});

test('coach prefers folding trash to a big bet and calling the nuts', () => {
  const base = { seat: 0, street: 'river', position: 'BTN', myBet: 0, stack: 1000, currentBet: 300, canRaise: true, minRaiseTo: 600, maxRaiseTo: 1000, bigBlind: 20, pot: 400, toCall: 300, opponents: [{ seat: 1, stack: 700, bet: 300, allIn: false }], actions: [] };
  const trash = Coach.analyze(Object.assign({}, base, { hole: cards('7c 2d'), board: cards('As Kd Qh 9s 4c') }));
  assert.strictEqual(trash.best.type, 'fold');
  const nuts = Coach.analyze(Object.assign({}, base, { hole: cards('Js Ts'), board: cards('As Kd Qh 9s 4c') }));
  assert.notStrictEqual(nuts.best.type, 'fold');
  assert.strictEqual(Coach.grade(trash, { type: 'call' }).grade, 'Blunder');
});

console.log(`\n${passed} tests passed`);
