// Poker Coach AI engine: cards, hand evaluator, equity, game flow, player agents and coach.
// Pure logic, no DOM. Works in the browser (window.Poker) and in Node (module.exports).
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUIT_LETTERS = 'shdc';
  const SUIT_GLYPHS = ['♠', '♥', '♦', '♣'];
  const SB = 10, BB = 20, START = 1000;
  const CATEGORIES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  // Cards are ints 0..51: rank = c >> 2 (0 = deuce, 12 = ace), suit = c & 3.
  const rankOf = c => c >> 2;
  const suitOf = c => c & 3;
  const cardText = c => RANKS[rankOf(c)] + SUIT_LETTERS[suitOf(c)];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function shuffledDeck() {
    const d = [];
    for (let c = 0; c < 52; c++) d.push(c);
    for (let i = 51; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // ---------- Hand evaluator (5 to 7 cards) ----------

  function straightHigh(mask) {
    for (let h = 12; h >= 4; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
    if ((mask & 15) === 15 && (mask >> 12) & 1) return 3; // A-2-3-4-5
    return -1;
  }

  const CAT_BASE = 1048576; // 16^5
  function encode(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 16 + ((ks[i] ?? -1) + 1);
    return v;
  }

  function score(cards) {
    const rc = new Array(13).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
    let mask = 0;
    for (const c of cards) {
      const r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const h = straightHigh(sm[flushSuit]);
      if (h >= 0) return encode(8, [h]);
    }
    const quads = [], trips = [], pairs = [], singles = [];
    for (let r = 12; r >= 0; r--) {
      if (rc[r] === 4) quads.push(r);
      else if (rc[r] === 3) trips.push(r);
      else if (rc[r] === 2) pairs.push(r);
      else if (rc[r] === 1) singles.push(r);
    }
    if (quads.length) {
      const k = Math.max(trips[0] ?? -1, pairs[0] ?? -1, singles[0] ?? -1);
      return encode(7, [quads[0], k]);
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      return encode(6, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
    }
    if (flushSuit >= 0) {
      const ks = [];
      for (let r = 12; r >= 0 && ks.length < 5; r--) if ((sm[flushSuit] >> r) & 1) ks.push(r);
      return encode(5, ks);
    }
    const sh = straightHigh(mask);
    if (sh >= 0) return encode(4, [sh]);
    if (trips.length) return encode(3, [trips[0], singles[0], singles[1]]);
    if (pairs.length >= 2) return encode(2, [pairs[0], pairs[1], Math.max(pairs[2] ?? -1, singles[0] ?? -1)]);
    if (pairs.length) return encode(1, [pairs[0], singles[0], singles[1], singles[2]]);
    return encode(0, singles.slice(0, 5));
  }

  const categoryName = s => CATEGORIES[Math.floor(s / CAT_BASE)];

  // ---------- Monte Carlo equity vs random hands ----------

  function equity(hole, board, nOpp, iters) {
    if (nOpp <= 0) return 1;
    const used = new Set(hole.concat(board));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    const need = nOpp * 2 + (5 - board.length);
    let won = 0;
    for (let i = 0; i < iters; i++) {
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (deck.length - k));
        const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      }
      const full = board.concat(deck.slice(nOpp * 2, need));
      const mine = score(hole.concat(full));
      let ties = 0, lost = false;
      for (let o = 0; o < nOpp && !lost; o++) {
        const s = score([deck[2 * o], deck[2 * o + 1]].concat(full));
        if (s > mine) lost = true;
        else if (s === mine) ties++;
      }
      if (!lost) won += 1 / (ties + 1);
    }
    return won / iters;
  }

  // ---------- Coach ----------
  // The coach only ever receives a view from Game.coachView(seat): the acting player's
  // own cards plus public table information. It never sees other players' cards.

  const LEARN_RATE = 0.01;

  function Coach() {
    this.cache = new Map();
  }

  Coach.prototype.equity = function (hole, board, nOpp) {
    const key = hole.slice().sort().join(',') + '|' + board.join(',') + '|' + nOpp;
    let eq = this.cache.get(key);
    if (eq === undefined) {
      if (this.cache.size > 4000) this.cache.clear();
      eq = equity(hole, board, nOpp, 600);
      this.cache.set(key, eq);
    }
    return eq;
  };

  // Value-raise threshold: a share of the gap between a fair share of the pot and certainty.
  const raiseThreshold = nOpp => {
    const fair = 1 / (nOpp + 1);
    return fair + (1 - fair) * 0.35;
  };

  Coach.prototype.advise = function (v) {
    const eq = this.equity(v.hole, v.board, v.nOpp);
    const required = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const raiseT = raiseThreshold(v.nOpp);
    let rec;
    if (eq >= raiseT && v.canRaise) rec = 'raise';
    else if (v.toCall === 0) rec = 'check';
    else if (eq >= required) rec = 'call';
    else rec = 'fold';
    return { eq, required, raiseT, rec, evCall: eq * (v.pot + v.toCall) - v.toCall };
  };

  const pct = x => Math.round(x * 100) + '%';

  Coach.prototype.review = function (v, d, adv) {
    const A = d.action, R = adv.rec, bb = v.bb;
    const eqTxt = `${pct(adv.eq)} to win against ${v.nOpp} opponent${v.nOpp === 1 ? '' : 's'}`;
    const betWord = v.toCall > 0 ? 'raise' : 'bet';
    let grade = 'good', loss = 0, note, leak = null;
    const lesson = [];

    if (A === R) {
      note = {
        fold: `Good fold. You had ${eqTxt} and needed ${pct(adv.required)} to call.`,
        check: `Good check. With ${eqTxt}, keep the pot small.`,
        call: `Good call. You had ${eqTxt} and needed only ${pct(adv.required)}.`,
        raise: `Good ${betWord}. ${cap(eqTxt)} is well ahead of a fair share.`,
      }[A];
    } else if (A === 'fold') {
      if (v.toCall === 0) {
        grade = 'blunder'; loss = adv.eq * v.pot / bb;
        note = 'Folded when checking was free. Never fold when nothing is owed.';
        leak = 'Folds when checking is free';
      } else {
        loss = Math.max(0, adv.evCall) / bb;
        grade = loss > 6 ? 'blunder' : 'mistake';
        note = `Folded with ${eqTxt}, but only ${pct(adv.required)} was needed to call.`;
        lesson.push(['callMargin', -LEARN_RATE]);
        if (R === 'raise') lesson.push(['raiseOffset', -LEARN_RATE / 2]);
        leak = 'Folds with the odds to call';
      }
    } else if (A === 'call') {
      if (R === 'fold') {
        loss = Math.max(0, -adv.evCall) / bb;
        grade = loss > 6 ? 'blunder' : 'mistake';
        note = `Called with ${eqTxt}, but needed ${pct(adv.required)}. Folding was cheaper.`;
        lesson.push(['callMargin', LEARN_RATE]);
        leak = 'Calls without the odds';
      } else {
        grade = 'ok';
        note = `Strong spot: ${eqTxt}. A raise builds the pot while you are ahead.`;
        lesson.push(['raiseOffset', -LEARN_RATE / 2]);
        leak = 'Misses value raises';
      }
    } else if (A === 'check') {
      grade = 'ok';
      note = `Checked with ${eqTxt}. A bet gets value from weaker hands.`;
      lesson.push(['raiseOffset', -LEARN_RATE / 2]);
      leak = 'Misses value bets';
    } else if (A === 'raise') {
      if (R === 'call') {
        grade = 'ok';
        note = `Raised with ${eqTxt}. Calling was enough here; the raise is optional.`;
        lesson.push(['raiseOffset', LEARN_RATE / 3]);
      } else if (R === 'check') {
        grade = 'ok';
        note = d.intent === 'bluff'
          ? `Bluffed with ${eqTxt}. Fine now and then, costly if overused.`
          : `Bet with only ${eqTxt}. Checking keeps the pot small with a medium hand.`;
        lesson.push(d.intent === 'bluff' ? ['bluff', -LEARN_RATE / 4] : ['raiseOffset', LEARN_RATE / 2]);
      } else {
        const put = d.raiseTo - v.myBet;
        const finalPot = v.pot + put + (d.raiseTo - v.currentBet);
        const evIfCalled = adv.eq * finalPot - put;
        loss = Math.max(0, -evIfCalled) * 0.5 / bb; // half credit for fold equity
        grade = loss > 6 ? 'blunder' : 'mistake';
        note = `Raised with ${eqTxt} while facing a bet that needed ${pct(adv.required)}. Folding was cheaper.`;
        lesson.push(d.intent === 'bluff' ? ['bluff', -LEARN_RATE / 2] : ['raiseOffset', LEARN_RATE]);
        leak = 'Raises weak hands into bets';
      }
    }
    return { grade, loss: Math.round(loss * 10) / 10, note, lesson, leak };
  };

  function cap(s) { return s[0].toUpperCase() + s.slice(1); }

  // ---------- Player agents ----------

  const PROFILES = [
    { name: 'Juno', style: 'Novice', callMargin: 0.06, raiseOffset: 0.06, bluff: 0.10, aggr: 0.5, noise: 0.16 },
    { name: 'Mira', style: 'Tight-aggressive', callMargin: 0.03, raiseOffset: 0.00, bluff: 0.08, aggr: 0.8, noise: 0.03 },
    { name: 'Dex', style: 'Loose-aggressive', callMargin: -0.06, raiseOffset: -0.08, bluff: 0.25, aggr: 0.9, noise: 0.06 },
    { name: 'Otto', style: 'Calling station', callMargin: -0.12, raiseOffset: 0.12, bluff: 0.02, aggr: 0.2, noise: 0.08 },
    { name: 'Rosa', style: 'Rock', callMargin: 0.12, raiseOffset: 0.08, bluff: 0.01, aggr: 0.5, noise: 0.04 },
    { name: 'Kai', style: 'Maniac', callMargin: -0.10, raiseOffset: -0.15, bluff: 0.40, aggr: 1.0, noise: 0.10 },
    { name: 'Theo', style: 'Balanced', callMargin: 0.00, raiseOffset: 0.00, bluff: 0.10, aggr: 0.6, noise: 0.03 },
  ];
  const PARAM_RANGE = { callMargin: [-0.2, 0.25], raiseOffset: [-0.2, 0.25], bluff: [0, 0.5] };

  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // A player agent decides from the same limited view the coach gets, using a cheaper,
  // noisier equity read and its own style settings.
  function botDecide(v, prof) {
    const est = clamp(equity(v.hole, v.board, v.nOpp, 160) + gauss() * prof.noise, 0, 1);
    const required = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const raiseT = raiseThreshold(v.nOpp) + prof.raiseOffset;
    const size = () => {
      let to = v.currentBet + Math.max(v.minRaise, Math.round(v.pot * (0.45 + 0.55 * prof.aggr) / BB) * BB);
      if (est > 0.8 && Math.random() < prof.aggr * 0.25) to = v.maxTo;
      return clamp(to, Math.min(v.minTo, v.maxTo), v.maxTo);
    };
    if (v.canRaise && est >= raiseT && Math.random() < 0.45 + 0.55 * prof.aggr) {
      return { action: 'raise', raiseTo: size(), intent: 'value' };
    }
    if (v.toCall === 0) {
      const bluffP = prof.bluff * (v.street === 'preflop' ? 0.3 : 1);
      if (v.canRaise && Math.random() < bluffP) return { action: 'raise', raiseTo: size(), intent: 'bluff' };
      return { action: 'check' };
    }
    if (est >= required + prof.callMargin) return { action: 'call' };
    if (v.canRaise && Math.random() < prof.bluff * 0.15) return { action: 'raise', raiseTo: size(), intent: 'bluff' };
    return { action: 'fold' };
  }

  // ---------- Game ----------

  function Game() {
    this.players = PROFILES.map((pr, seat) => ({
      seat, name: pr.name, style: pr.style,
      startProf: { ...pr },
      prof: { callMargin: pr.callMargin, raiseOffset: pr.raiseOffset, bluff: pr.bluff, aggr: pr.aggr, noise: pr.noise },
      chips: START, rebuys: 0, hole: [], bet: 0, totalIn: 0,
      folded: false, allIn: false, acted: false, human: false, showed: false, vpipHand: false, lastAction: '',
      stats: { hands: 0, vpip: 0, decisions: 0, good: 0, ok: 0, mistakes: 0, evLost: 0, trail: [], leaks: {} },
    }));
    this.coach = new Coach();
    this.dealer = -1; this.handNo = 0; this.street = 'idle';
    this.board = []; this.deck = []; this.currentBet = 0; this.minRaise = BB; this.toAct = -1;
    this.actions = []; this.reviews = []; this.learning = true; this.lastResult = null;
    this.reviewSeq = 0;
  }

  const G = Game.prototype;
  G.N = PROFILES.length;
  G.pot = function () { return this.players.reduce((s, p) => s + p.totalIn, 0); };
  G.live = function () { return this.players.filter(p => !p.folded); };
  const canAct = p => !p.folded && !p.allIn;

  G.findNext = function (from) {
    for (let k = 1; k <= this.N; k++) {
      const p = this.players[(from + k) % this.N];
      if (canAct(p) && (!p.acted || p.bet < this.currentBet)) return p.seat;
    }
    return -1;
  };

  G.put = function (p, amt) {
    const a = Math.min(amt, p.chips);
    p.chips -= a; p.bet += a; p.totalIn += a;
    if (p.chips === 0) p.allIn = true;
    return a;
  };

  G.startHand = function () {
    this.handNo++;
    for (const p of this.players) {
      if (p.chips < BB) { p.chips = START; p.rebuys++; }
      Object.assign(p, { hole: [], bet: 0, totalIn: 0, folded: false, allIn: false, acted: false, showed: false, vpipHand: false, lastAction: '' });
    }
    this.dealer = (this.dealer + 1) % this.N;
    this.deck = shuffledDeck();
    this.board = []; this.actions = []; this.lastResult = null;
    this.street = 'preflop'; this.currentBet = 0; this.minRaise = BB;
    for (let r = 0; r < 2; r++) for (let k = 1; k <= this.N; k++) this.players[(this.dealer + k) % this.N].hole.push(this.deck.pop());
    const sbSeat = (this.dealer + 1) % this.N, bbSeat = (this.dealer + 2) % this.N;
    const sbP = this.players[sbSeat], bbP = this.players[bbSeat];
    this.put(sbP, SB); sbP.lastAction = 'Small blind';
    this.put(bbP, BB); bbP.lastAction = 'Big blind';
    this.currentBet = BB;
    this.actions.push({ street: 'preflop', text: `${sbP.name} posts ${SB}` }, { street: 'preflop', text: `${bbP.name} posts ${BB}` });
    this.toAct = this.findNext(bbSeat);
  };

  // Everything the acting player can legally know. This is the only input to the coach and bots.
  G.coachView = function (seat) {
    const p = this.players[seat];
    const toCall = Math.min(this.currentBet - p.bet, p.chips);
    const others = this.players.filter(q => q !== p && !q.folded);
    const maxTo = p.bet + p.chips;
    return {
      hand: this.handNo, street: this.street, bb: BB,
      hole: p.hole.slice(), board: this.board.slice(),
      pot: this.pot(), toCall, myBet: p.bet, stack: p.chips,
      currentBet: this.currentBet, minRaise: this.minRaise,
      minTo: this.currentBet + this.minRaise, maxTo,
      canRaise: maxTo > this.currentBet && others.some(canAct),
      nOpp: others.length,
      opponents: others.map(q => ({ name: q.name, stack: q.chips, bet: q.bet, allIn: q.allIn })),
      history: this.actions.map(a => a.text),
    };
  };

  G.botDecide = function (seat) { return botDecide(this.coachView(seat), this.players[seat].prof); };

  G.act = function (seat, d) {
    if (seat !== this.toAct || this.street === 'done') return null;
    const p = this.players[seat];
    const v = this.coachView(seat);
    let action = d.action;
    if (action === 'check' && v.toCall > 0) action = 'call';
    if (action === 'call' && v.toCall === 0) action = 'check';
    if (action === 'raise' && !v.canRaise) action = v.toCall > 0 ? 'call' : 'check';
    let raiseTo = 0;
    if (action === 'raise') {
      raiseTo = clamp(Math.round(d.raiseTo || v.minTo), Math.min(v.minTo, v.maxTo), v.maxTo);
      if (raiseTo <= v.currentBet) action = v.toCall > 0 ? 'call' : 'check';
    }
    const dec = { action, raiseTo, intent: d.intent || '' };
    const adv = this.coach.advise(v);
    const rev = this.coach.review(v, dec, adv);
    const text = this.apply(p, dec);
    const record = this.record(p, v, dec, adv, rev, text);
    this.advance(seat);
    return record;
  };

  G.apply = function (p, dec) {
    let text;
    if (dec.action === 'fold') { p.folded = true; text = 'folds'; }
    else if (dec.action === 'check') text = 'checks';
    else if (dec.action === 'call') {
      const amt = this.put(p, this.currentBet - p.bet);
      text = `calls ${amt}` + (p.allIn ? ' (all-in)' : '');
    } else {
      const wasBet = this.currentBet === 0;
      this.put(p, dec.raiseTo - p.bet);
      const inc = p.bet - this.currentBet;
      if (inc >= this.minRaise) this.minRaise = inc;
      this.currentBet = p.bet;
      for (const q of this.players) if (q !== p) q.acted = false;
      text = (wasBet ? 'bets ' : 'raises to ') + p.bet + (p.allIn ? ' (all-in)' : '');
    }
    p.acted = true;
    if (this.street === 'preflop' && (dec.action === 'call' || dec.action === 'raise')) p.vpipHand = true;
    p.lastAction = text[0].toUpperCase() + text.slice(1);
    this.actions.push({ street: this.street, text: `${p.name} ${text}` });
    return text;
  };

  G.record = function (p, v, dec, adv, rev, text) {
    const s = p.stats;
    s.decisions++;
    if (rev.grade === 'good') s.good++;
    else if (rev.grade === 'ok') s.ok++;
    else s.mistakes++;
    s.evLost += rev.loss;
    s.trail.push(rev.grade === 'good' ? 1 : rev.grade === 'ok' ? 0.5 : 0);
    if (s.trail.length > 400) s.trail.shift();
    if (rev.leak && rev.grade !== 'good') s.leaks[rev.leak] = (s.leaks[rev.leak] || 0) + 1;
    if (this.learning && !p.human) {
      for (const [param, delta] of rev.lesson) {
        const [lo, hi] = PARAM_RANGE[param];
        p.prof[param] = clamp(p.prof[param] + delta, lo, hi);
      }
      p.prof.noise = Math.max(0.01, p.prof.noise * 0.997); // practice sharpens reads
    }
    const r = {
      id: ++this.reviewSeq, hand: v.hand, street: v.street, seat: p.seat, name: p.name, human: p.human,
      view: v, decision: dec, actionText: text, rec: adv.rec, eq: adv.eq, required: adv.required,
      grade: rev.grade, loss: rev.loss, note: rev.note, leak: rev.leak,
    };
    this.reviews.push(r);
    if (this.reviews.length > 500) this.reviews.shift();
    return r;
  };

  G.advance = function (seat) {
    if (this.live().length === 1) return this.awardUncontested();
    this.toAct = this.findNext(seat);
  };

  G.nextStreet = function () {
    for (const p of this.players) { p.bet = 0; p.acted = false; }
    this.currentBet = 0; this.minRaise = BB;
    if (this.street === 'river') return this.showdown();
    this.deck.pop(); // burn
    const n = this.street === 'preflop' ? 3 : 1;
    for (let i = 0; i < n; i++) this.board.push(this.deck.pop());
    this.street = STREETS[STREETS.indexOf(this.street) + 1];
    for (const p of this.players) if (!p.folded) p.lastAction = p.allIn ? 'All-in' : '';
    this.toAct = this.players.filter(canAct).length >= 2 ? this.findNext(this.dealer) : -1;
  };

  G.awardUncontested = function () {
    const w = this.live()[0];
    const pot = this.pot();
    w.chips += pot;
    this.finish([{ seat: w.seat, name: w.name, amount: pot, hand: null }]);
  };

  G.showdown = function () {
    const live = this.live();
    for (const p of live) { p.score = score(p.hole.concat(this.board)); p.showed = true; }
    const won = new Array(this.N).fill(0);
    const levels = [...new Set(live.map(p => p.totalIn))].sort((a, b) => a - b);
    let prev = 0, paid = 0;
    for (const lvl of levels) {
      let slice = 0;
      for (const p of this.players) slice += Math.min(p.totalIn, lvl) - Math.min(p.totalIn, prev);
      const elig = live.filter(p => p.totalIn >= lvl);
      const best = Math.max(...elig.map(p => p.score));
      const winners = elig.filter(p => p.score === best);
      const share = Math.floor(slice / winners.length);
      winners.forEach((w, k) => { won[w.seat] += share + (k === 0 ? slice - share * winners.length : 0); });
      paid += slice; prev = lvl;
    }
    const leftover = this.pot() - paid; // chips above every live player's stake
    if (leftover > 0) {
      const best = live.reduce((a, b) => (b.score > a.score ? b : a));
      won[best.seat] += leftover;
    }
    const result = [];
    for (const p of live) {
      if (won[p.seat] > 0) {
        p.chips += won[p.seat];
        result.push({ seat: p.seat, name: p.name, amount: won[p.seat], hand: categoryName(p.score) });
      }
    }
    this.finish(result);
  };

  G.finish = function (winners) {
    for (const p of this.players) {
      p.stats.hands++;
      if (p.vpipHand) p.stats.vpip++;
    }
    for (const w of winners) this.players[w.seat].lastAction = `Wins ${w.amount}` + (w.hand ? ` · ${w.hand}` : '');
    this.lastResult = { hand: this.handNo, winners, board: this.board.slice() };
    this.street = 'done';
    this.toAct = -1;
  };

  // Advance the game by one visible unit. Returns 'deal' | 'street' | 'act' | 'wait'.
  G.step = function () {
    if (this.street === 'idle' || this.street === 'done') { this.startHand(); return 'deal'; }
    if (this.toAct === -1) { this.nextStreet(); return 'street'; }
    if (this.players[this.toAct].human) return 'wait';
    this.act(this.toAct, this.botDecide(this.toAct));
    return 'act';
  };

  // Compact one-line summary of a decision for an LLM prompt (token-lean by design).
  function viewSummary(r) {
    const v = r.view;
    const cards = a => a.map(cardText).join('') || '-';
    const opp = v.opponents.map(o => `${o.name} ${o.stack}${o.allIn ? ' all-in' : ''}`).join(', ');
    return [
      `Hand ${v.hand} ${v.street}`,
      `hero ${cards(v.hole)}`,
      `board ${cards(v.board)}`,
      `pot ${v.pot}, to call ${v.toCall}, stack ${v.stack}, blinds ${SB}/${BB}`,
      `${v.nOpp} opp: ${opp}`,
      `history: ${v.history.slice(-6).join('; ')}`,
      `decision: ${r.actionText}`,
      `local estimate: ${pct(r.eq)} equity vs random hands, ${pct(r.required)} needed`,
    ].join(' | ');
  }

  const API = {
    RANKS, SUIT_GLYPHS, SB, BB, START, CATEGORIES, PROFILES,
    rankOf, suitOf, cardText, score, categoryName, equity, Coach, Game, viewSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Poker = API;
})(typeof window !== 'undefined' ? window : globalThis);
