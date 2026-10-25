// Coach: Monte Carlo equity + pot odds -> best action, grade, chip loss in BB, lesson.
// Reads only coachView(seat). All math is local; no LLM calls.
(function (root) {
  'use strict';

  const PE = typeof require !== 'undefined' ? require('./engine.js') : root.PokerEngine;
  const { rankOf, suitOf, fullDeck, evaluate } = PE;

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const round5 = (x) => Math.round(x / 5) * 5;

  // Chen formula preflop score, about -1 (worst) to 20 (AA).
  function chen(a, b) {
    let hi = rankOf(a), lo = rankOf(b);
    if (lo > hi) [hi, lo] = [lo, hi];
    const top = { 14: 10, 13: 8, 12: 7, 11: 6 };
    let s = top[hi] || hi / 2;
    if (hi === lo) return Math.max(5, s * 2);
    if (suitOf(a) === suitOf(b)) s += 2;
    const gap = hi - lo - 1;
    s -= [0, 1, 2, 4][gap] ?? 5;
    if (gap <= 1 && hi < 12) s += 1;
    return Math.ceil(s);
  }

  // Minimum Chen score we assume for an opponent, from their public preflop actions.
  function rangeFloor(actions, seat) {
    let floor = 0;
    for (const a of actions) {
      if (a.seat !== seat || a.street !== 'preflop') continue;
      if (a.type === 'raise') floor = Math.max(floor, 8);
      else if (a.type === 'call') floor = Math.max(floor, 5);
    }
    return floor;
  }

  // Share of the pot we win against opponents whose hands are drawn above their range floors.
  function equity(hole, board, floors, iters = 800, rng = Math.random) {
    if (!floors.length) return 1;
    const used = new Uint8Array(64);
    for (const c of hole) used[c] = 1;
    for (const c of board) used[c] = 1;
    const deck = fullDeck().filter((c) => !used[c]);
    const N = deck.length;
    const need = 5 - board.length;
    const drawn = [];
    const draw = () => {
      let c;
      do { c = deck[Math.floor(rng() * N)]; } while (used[c]);
      used[c] = 1;
      drawn.push(c);
      return c;
    };
    let total = 0;
    for (let it = 0; it < iters; it++) {
      drawn.length = 0;
      const opp = [];
      for (const f of floors) {
        let a, b;
        for (let t = 0; t < 30; t++) {
          a = draw(); b = draw();
          if (f <= 0 || t === 29 || chen(a, b) >= f) break;
          used[a] = 0; used[b] = 0; drawn.length -= 2;
        }
        opp.push(a, b);
      }
      const full = board.slice();
      for (let k = 0; k < need; k++) full.push(draw());
      const mine = evaluate(hole.concat(full));
      let ties = 0, lose = false;
      for (let k = 0; k < opp.length; k += 2) {
        const v = evaluate([opp[k], opp[k + 1]].concat(full));
        if (v > mine) { lose = true; break; }
        if (v === mine) ties++;
      }
      if (!lose) total += 1 / (ties + 1);
      for (const c of drawn) used[c] = 0;
    }
    return total / iters;
  }

  // Who we are really up against. Preflop, players yet to act mostly fold, so we
  // model them as a few likely continuers instead of a full table of random hands.
  function opponentModel(v) {
    if (v.street !== 'preflop') {
      return { floors: v.opponents.map((o) => rangeFloor(v.actions, o.seat)), entered: v.opponents, pending: [] };
    }
    const voluntary = new Set(v.actions.filter((a) => a.street === 'preflop' && (a.type === 'call' || a.type === 'raise')).map((a) => a.seat));
    const entered = v.opponents.filter((o) => voluntary.has(o.seat));
    const pending = v.opponents.filter((o) => !voluntary.has(o.seat));
    const floors = entered.map((o) => rangeFloor(v.actions, o.seat));
    const virtual = Math.max(entered.length ? 0 : 1, Math.round(pending.length * 0.2));
    for (let i = 0; i < virtual; i++) floors.push(7);
    return { floors, entered, pending };
  }

  function defaultRaiseTo(v) {
    let to;
    if (v.street === 'preflop') to = v.currentBet <= v.bigBlind ? 3 * v.bigBlind : 3 * v.currentBet;
    else to = v.currentBet === 0 ? v.pot * 0.66 : v.currentBet * 3;
    return clamp(round5(to), v.minRaiseTo, v.maxRaiseTo);
  }

  function foldEquity(v, model, to) {
    if (v.opponents.some((o) => o.allIn)) return 0;
    const add = to - v.myBet;
    const ratio = add / (v.pot + add);
    const per = Math.min(0.75, 0.15 + 0.6 * ratio) * (v.street === 'preflop' ? 0.9 : 1);
    return Math.pow(per, model.entered.length) * Math.pow(0.8, model.pending.length);
  }

  // One-street EV in chips, relative to folding now.
  function evRaise(v, model, E, to) {
    const add = to - v.myBet;
    const ratio = add / (v.pot + add);
    const fe = foldEquity(v, model, to);
    const callerAdd = Math.max(0, to - v.currentBet);
    const eCalled = clamp(E - 0.04 - 0.12 * ratio, 0, 1); // callers hold stronger hands
    return fe * v.pot + (1 - fe) * (eCalled * (v.pot + add + callerAdd) - add);
  }

  function analyze(v, opts = {}) {
    const model = opponentModel(v);
    const E = equity(v.hole, v.board, model.floors, opts.iters || 800, opts.rng);
    const potOdds = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const options = [];
    if (v.toCall > 0) {
      options.push({ type: 'fold', ev: 0 });
      options.push({ type: 'call', amount: v.toCall, ev: E * (v.pot + v.toCall) - v.toCall });
    } else {
      options.push({ type: 'check', ev: E * v.pot });
    }
    let raiseTo = null;
    if (v.canRaise) {
      raiseTo = defaultRaiseTo(v);
      options.push({ type: 'raise', amount: raiseTo, ev: evRaise(v, model, E, raiseTo) });
    }
    const best = options.reduce((a, b) => (b.ev > a.ev ? b : a));
    return { view: v, model, nEff: model.floors.length, equity: E, potOdds, options, best, raiseTo };
  }

  function evOf(a, d) {
    if (d.type === 'raise' && a.view.canRaise) return evRaise(a.view, a.model, a.equity, d.amount);
    const type = d.type === 'raise' ? (a.view.toCall > 0 ? 'call' : 'check') : d.type;
    const o = a.options.find((x) => x.type === type);
    return o ? o.ev : 0;
  }

  const pct = (x) => Math.round(x * 100) + '%';

  function describe(d, v) {
    if (d.type === 'fold') return 'Folding';
    if (d.type === 'check') return 'Checking';
    if (d.type === 'call') return `Calling ${v.toCall}`;
    return `${v.currentBet === 0 ? 'Betting' : 'Raising to'} ${d.amount}`;
  }

  function lesson(a, d, lossBB, g) {
    const v = a.view;
    const E = pct(a.equity);
    const need = pct(a.potOdds);
    const opp = a.nEff === 1 ? '1 opponent' : `${a.nEff} opponents`;
    if (g === 'Good' && d.type !== a.best.type) {
      return `Close spot: ${describe(a.best, v).toLowerCase()} was only about ${lossBB.toFixed(1)} BB better. Equity about ${E}${v.toCall ? `, needed ${need}` : ''}.`;
    }
    if (g === 'Good') {
      if (d.type === 'fold') return `Good fold: about ${E} equity vs ${opp}, and calling ${v.toCall} needed ${need}.`;
      if (d.type === 'call') return `Good call: about ${E} equity, and the price only needed ${need}.`;
      if (d.type === 'check') return `Fine check: about ${E} equity vs ${opp}; betting would not have earned more.`;
      return `Good ${v.currentBet === 0 ? 'bet' : 'raise'}: about ${E} equity vs ${opp}, so you get value and fold equity.`;
    }
    const save = `${describe(a.best, v)} was worth about ${lossBB.toFixed(1)} BB more.`;
    const b = a.best.type;
    if (d.type === 'call' && b === 'fold') return `Calling ${v.toCall} into ${v.pot} needs ${need} equity; you had about ${E}. ${save}`;
    if (d.type === 'fold' && b === 'call') return `Too tight: you needed only ${need} to call and had about ${E}. ${save}`;
    if (d.type === 'fold' && b === 'raise') return `You folded a strong spot: about ${E} equity vs ${opp}. ${save}`;
    if (d.type === 'fold' && b === 'check') return `Never fold when you can check for free. ${save}`;
    if ((d.type === 'call' || d.type === 'check') && b === 'raise') return `Too passive: with about ${E} equity vs ${opp}, betting builds the pot or wins it now. ${save}`;
    if (d.type === 'raise' && b !== 'raise') return `That ${v.currentBet === 0 ? 'bet' : 'raise'} did not pay: about ${E} equity and little fold equity vs ${opp}. ${save}`;
    if (d.type === 'raise') return `Sizing: ${save}`;
    return save;
  }

  function gradeOf(lossBB) {
    if (lossBB <= 0.3) return 'Good';
    if (lossBB <= 1.5) return 'Okay';
    if (lossBB <= 5) return 'Mistake';
    return 'Blunder';
  }

  function grade(a, d) {
    const lossBB = Math.max(0, a.best.ev - evOf(a, d)) / a.view.bigBlind;
    const g = gradeOf(lossBB);
    return { grade: g, lossBB, chosen: d, best: a.best, lesson: lesson(a, d, lossBB, g) };
  }

  function hint(a) {
    const v = a.view;
    const odds = v.toCall > 0 ? `, you need ${pct(a.potOdds)} to call` : '';
    return `${describe(a.best, v)} is best. Equity about ${pct(a.equity)} vs ${a.nEff === 1 ? '1 opponent' : a.nEff + ' opponents'}${odds}.`;
  }

  const api = { chen, rangeFloor, equity, opponentModel, analyze, grade, hint, describe, evOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerCoach = api;
})(this);
