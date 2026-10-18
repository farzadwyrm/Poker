// Poker Coach AI engine: cards, hand evaluator, equity, strategy, game flow, player agents and coach.
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
  const pct = x => Math.round(x * 100) + '%';
  const cap = s => s[0].toUpperCase() + s.slice(1);

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

  // ---------- Starting hands and ranges ----------
  // Ordering of the 169 starting hands, strongest first, built by tools/rank169.js
  // (heads-up equity plus small bonuses for suited, connected and paired hands).
  const PREFLOP_ORDER = 'AA KK QQ JJ TT 99 88 AKs AQs 77 AJs 66 ATs KQs AKo KJs A8s A9s AQo KTs A7s QJs AJo K9s 55 A5s QTs KQo ATo A6s JTs A4s K8s A3s KJo 44 A9o K7s KTo J9s Q9s A2s A7o QJo A8o Q8s K6s K9o A5o QTo T9s K4s K5s 33 Q7s A4o J8s Q6s A6o K8o JTo A3o K3s T8s K7o Q5s A2o J7s Q4s K2s 98s Q9o J9o T7s K6o Q8o Q3s 22 Q2s J6s K5o T9o K4o J5s 97s T6s Q7o J8o K3o 87s J3s Q6o J4s Q5o T8o T5s 96s J2s K2o 86s T4s J7o Q4o 76s 95s 98o Q3o T3s T7o T2s J5o J6o 97o 75s 85s Q2o 65s J4o 94s T6o 87o J3o 93s 84s 64s 92s 54s T4o T5o 86o J2o 96o 74s 76o 83s 73s 82s 53s T3o 63s 95o 43s T2o 75o 85o 72s 65o 52s 94o 42s 62s 93o 92o 32s 54o 84o 64o 74o 53o 83o 82o 63o 73o 43o 72o 52o 62o 42o 32o'.split(' ');

  // Percentile of each hand class: the share of all 1,326 combos that are this strong or stronger.
  const PCT = {};
  (function () {
    let combos = 0;
    for (const k of PREFLOP_ORDER) {
      combos += k.length === 2 ? 6 : k[2] === 's' ? 4 : 12;
      PCT[k] = combos / 1326;
    }
  })();

  function handKey(hole) {
    const [a, b] = hole[0] >> 2 >= hole[1] >> 2 ? hole : [hole[1], hole[0]];
    const ra = RANKS[a >> 2], rb = RANKS[b >> 2];
    if (ra === rb) return ra + rb;
    return ra + rb + ((a & 3) === (b & 3) ? 's' : 'o');
  }
  const handPct = hole => PCT[handKey(hole)];

  // All 1,326 two-card combos sorted strongest first, so a range is a prefix of this list.
  const COMBOS = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b, PCT[handKey([a, b])]]);
  COMBOS.sort((x, y) => x[2] - y[2]);
  function rangeSize(lim) {
    let lo = 0, hi = COMBOS.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (COMBOS[m][2] <= lim + 1e-9) lo = m + 1; else hi = m; }
    return Math.max(lo, 6);
  }

  // Positions at a 7-handed table, by offset from the dealer button.
  const POS_BY_OFFSET = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'];
  const POS_NAMES = { BTN: 'Button', SB: 'Small blind', BB: 'Big blind', UTG: 'Under the gun', MP: 'Middle position', HJ: 'Hijack', CO: 'Cutoff' };
  // Approximate solver opening ranges (share of hands raised first in), adapted from 6-max 100bb charts.
  const OPEN = { UTG: 0.15, MP: 0.18, HJ: 0.22, CO: 0.28, BTN: 0.44, SB: 0.38, BB: 0.15 };
  const postflopOrder = pos => (POS_BY_OFFSET.indexOf(pos) + 6) % 7; // SB acts first, BTN last

  // ---------- Board reading ----------

  function texture(board) {
    if (board.length < 3) return 'none';
    const suits = [0, 0, 0, 0];
    board.forEach(c => suits[c & 3]++);
    const rs = [...new Set(board.map(rankOf))].sort((a, b) => a - b);
    let connected = false;
    for (let i = 0; i + 2 < rs.length; i++) if (rs[i + 2] - rs[i] <= 4) connected = true;
    return Math.max(...suits) >= 2 || connected ? 'wet' : 'dry';
  }

  // Draws the hero holds (using at least one hole card) and their outs.
  function draws(hole, board) {
    if (board.length < 3 || board.length > 4) return { outs: 0, names: [] };
    const all = hole.concat(board);
    const names = [];
    let outs = 0;
    for (let s = 0; s < 4; s++) {
      const n = all.filter(c => (c & 3) === s).length;
      if (n === 4 && hole.some(c => (c & 3) === s)) { names.push('flush draw'); outs += 9; }
    }
    if (score(all) < 4 * CAT_BASE) {
      let mask = 0;
      all.forEach(c => { mask |= 1 << rankOf(c); });
      const ext = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace low
      let open = false, gut = false;
      for (let st = 0; st <= 10; st++) {
        if (((ext >> st) & 15) === 15) { if (st >= 1 && st + 4 <= 13) open = true; else gut = true; }
      }
      for (let lo = 0; lo <= 9 && !open && !gut; lo++) {
        const win = (ext >> lo) & 31;
        if ([0, 1, 2, 3, 4].filter(i => (win >> i) & 1).length === 4) gut = true;
      }
      if (open) { names.push('open-ended straight draw'); outs += 8; }
      else if (gut) { names.push('gutshot straight draw'); outs += 4; }
    }
    if (names.length === 2) outs -= 2; // shared outs between flush and straight draws
    return { outs, names };
  }

  // ---------- Equity ----------

  // Monte Carlo equity. ranges: optional array of percentile limits, one per opponent;
  // each opponent is dealt a random hand within its range (rejection sampling).
  function equity(hole, board, nOpp, iters, ranges) {
    if (nOpp <= 0) return 1;
    const used = new Set(hole.concat(board));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    const L = deck.length;
    let won = 0;
    const taken = new Uint8Array(52);
    for (let i = 0; i < iters; i++) {
      taken.fill(0);
      const opp = [];
      for (let o = 0; o < nOpp; o++) {
        const size = ranges && ranges[o] < 1 ? rangeSize(ranges[o]) : COMBOS.length;
        let a, b, tries = 0;
        do {
          const pick = COMBOS[Math.floor(Math.random() * (tries < 60 ? size : COMBOS.length))];
          a = pick[0]; b = pick[1]; tries++;
        } while (taken[a] || taken[b] || used.has(a) || used.has(b));
        taken[a] = taken[b] = 1;
        opp.push(a, b);
      }
      const full = board.slice();
      while (full.length < 5) {
        const c = deck[Math.floor(Math.random() * L)];
        if (!taken[c]) { taken[c] = 1; full.push(c); }
      }
      const mine = score(hole.concat(full));
      let ties = 0, lost = false;
      for (let o = 0; o < nOpp && !lost; o++) {
        const s = score([opp[2 * o], opp[2 * o + 1]].concat(full));
        if (s > mine) lost = true;
        else if (s === mine) ties++;
      }
      if (!lost) won += 1 / (ties + 1);
    }
    return won / iters;
  }

  // Range each opponent is likely to hold, read from their public actions only.
  function rangeFor(seat, view) {
    let r = 1, raises = 0;
    for (const a of view.actions) {
      if (a.street === 'preflop') {
        if (a.type === 'raise') {
          if (a.seat === seat) r = raises === 0 ? (OPEN[view.posOf[seat]] || 0.15) : raises === 1 ? 0.08 : 0.03;
          raises++;
        } else if (a.type === 'call' && a.seat === seat) {
          r = raises === 0 ? 0.5 : raises === 1 ? 0.28 : 0.08;
        }
      } else if (a.seat === seat) {
        if (a.type === 'raise') r *= 0.6;
        else if (a.type === 'call') r *= 0.8;
      }
    }
    return Math.max(0.02, r);
  }

  // ---------- Strategy (the coach's baseline; v2 can swap in a solver table here) ----------

  const fairShare = n => 1 / (n + 1);
  const valueThreshold = n => fairShare(n) + (1 - fairShare(n)) * 0.3;

  function preflopPlan(v, pctAdj) {
    const p = pctAdj ?? handPct(v.hole);
    const pre = v.actions.filter(a => a.street === 'preflop');
    const raisesList = pre.filter(a => a.type === 'raise');
    const limpers = pre.filter(a => a.type === 'call').length;
    const key = handKey(v.hole), pos = v.pos;
    const top = `${key} is in the top ${pct(p)} of starting hands`;
    let rec, accept, raiseTo = 0, reason, concept;

    if (raisesList.length === 0) {
      const open = OPEN[pos];
      raiseTo = BB * (pos === 'SB' ? 3 : 2.5) + limpers * BB;
      if (v.toCall === 0) { // big blind option
        rec = p <= 0.25 ? 'raise' : 'check';
        reason = rec === 'raise' ? `${top}. Raise the limpers for value.` : `${top}. Check and see a free flop.`;
        concept = 'position';
      } else if (p <= open) {
        rec = 'raise';
        reason = `From the ${POS_NAMES[pos].toLowerCase()}, a solid strategy opens about ${pct(open)} of hands. ${top}, so raise to ${raiseTo}.`;
        concept = 'ranges';
      } else {
        rec = 'fold';
        reason = `From the ${POS_NAMES[pos].toLowerCase()}, open only about the top ${pct(open)}. ${top}, so fold.`;
        concept = 'ranges';
      }
      accept = [rec];
    } else {
      const last = raisesList[raisesList.length - 1];
      const raiserPos = v.posOf[last.seat];
      const ip = postflopOrder(pos) > postflopOrder(raiserPos);
      if (raisesList.length === 1) {
        const rr = OPEN[raiserPos] || 0.15;
        const threeBet = Math.max(0.03, rr * 0.3);
        let callR = pos === 'BB' ? Math.min(0.55, rr * 1.5) : pos === 'SB' ? rr * 0.5 : ip ? rr * 0.75 : rr * 0.6;
        if (pre.filter(a => a.type === 'call').length) callR *= 0.85;
        raiseTo = Math.round(v.currentBet * (ip ? 3 : 4) / 10) * 10;
        if (p <= threeBet) { rec = 'raise'; reason = `${top}, strong enough to re-raise (3-bet) an opener from ${raiserPos} to ${raiseTo}.`; }
        else if (p <= callR) { rec = 'call'; reason = `${top}. Against a ${raiserPos} open (about ${pct(rr)} of hands) this is a call${ip ? ', helped by acting last after the flop' : ''}.`; }
        else { rec = 'fold'; reason = `A ${raiserPos} opener holds about the top ${pct(rr)}. ${top}, which plays poorly against that range. Fold.`; }
        concept = 'ranges';
      } else if (raisesList.length === 2) {
        raiseTo = Math.round(v.currentBet * 2.3 / 10) * 10;
        if (p <= 0.025) { rec = 'raise'; reason = `${top}. Facing a 3-bet, 4-bet the very best hands.`; }
        else if (p <= 0.10) { rec = 'call'; reason = `${top}. Strong enough to call a 3-bet, not to 4-bet.`; }
        else { rec = 'fold'; reason = `A 3-bet range is narrow, so continue with about the top 10%. ${top}. Fold.`; }
        concept = 'ranges';
      } else {
        raiseTo = v.maxTo;
        if (p <= 0.02) { rec = 'raise'; reason = `${top}. Against a 4-bet, only premium pairs and AK continue, and this one goes all-in.`; }
        else if (p <= 0.035) { rec = 'call'; reason = `${top}. Just good enough to call a 4-bet.`; }
        else { rec = 'fold'; reason = `A 4-bet range is the top 2–3% of hands. ${top}. Fold.`; }
        concept = 'ranges';
      }
      accept = [rec];
      if (rec === 'raise') accept.push('call');
    }
    if (rec === 'raise' && !v.canRaise) { rec = v.toCall > 0 ? 'call' : 'check'; accept = [rec]; }
    return { rec, accept, raiseTo: clamp(raiseTo, Math.min(v.minTo, v.maxTo), v.maxTo), reason, concept, handPct: p };
  }

  function postflopPlan(v, eq) {
    const n = v.nOpp;
    const required = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const valueT = valueThreshold(n);
    const tex = texture(v.board);
    const dr = draws(v.hole, v.board);
    const eqTxt = `about ${pct(eq)} equity against the hands your opponent${n === 1 ? '' : 's'} likely hold${n === 1 ? 's' : ''}`;
    const drawTxt = dr.names.length ? ` You have a ${dr.names.join(' and ')} (${dr.outs} outs).` : '';
    let rec, accept, raiseTo = 0, reason, concept;

    if (v.toCall === 0) {
      const frac = tex === 'wet' ? 0.66 : 0.33;
      raiseTo = Math.max(BB, Math.round(v.pot * frac / 10) * 10);
      if (eq >= valueT && v.canRaise) {
        rec = 'raise'; accept = ['raise'];
        reason = `You have ${eqTxt}, enough to bet for value. On a ${tex} board, bet about ${Math.round(frac * 100)}% of the pot (${raiseTo}).`;
        concept = 'sizing';
      } else if (v.aggressor === v.seat && v.street === 'flop' && n === 1 && tex === 'dry' && v.canRaise) {
        rec = 'raise'; accept = ['raise', 'check']; raiseTo = Math.max(BB, Math.round(v.pot * 0.33 / 10) * 10);
        reason = `You raised before the flop, and this dry board favours your range. A small continuation bet (${raiseTo}, a third of the pot) works with much of your range. Checking is also fine.`;
        concept = 'cbet';
      } else if (dr.outs >= 8 && n <= 2 && v.canRaise) {
        rec = 'raise'; accept = ['raise', 'check']; raiseTo = Math.max(BB, Math.round(v.pot * 0.5 / 10) * 10);
        reason = `You have ${eqTxt}.${drawTxt} A semi-bluff bet of ${raiseTo} can win now or improve later. Checking is also fine.`;
        concept = 'draws';
      } else {
        rec = 'check'; accept = ['check'];
        reason = `You have ${eqTxt}.${drawTxt} Not strong enough to bet for value, so check.`;
        concept = 'equity';
      }
    } else {
      const potBefore = v.pot - v.toCall, mdf = potBefore / (potBefore + v.toCall);
      raiseTo = Math.round(v.currentBet * 3 / 10) * 10;
      const odds = `Calling ${v.toCall} to win ${v.pot + v.toCall} needs ${pct(required)} equity`;
      if (eq >= valueT + 0.12 && v.canRaise) {
        rec = 'raise'; accept = ['raise', 'call'];
        reason = `You have ${eqTxt}, well ahead. Raise to about ${raiseTo} for value; calling is also fine.`;
        concept = 'sizing';
      } else if (eq >= required) {
        rec = 'call'; accept = ['call'];
        if (dr.outs >= 8 && v.canRaise) accept.push('raise');
        reason = `${odds}, and you have ${eqTxt}.${drawTxt} Call.`;
        concept = 'potodds';
      } else {
        rec = 'fold'; accept = ['fold'];
        reason = `${odds}, but you have only ${eqTxt}.${drawTxt} Against this bet you only need to defend ${pct(mdf)} of your range; this hand is in the part that folds.`;
        concept = 'mdf';
      }
    }
    if (rec === 'raise' && !v.canRaise) { rec = v.toCall > 0 ? 'call' : 'check'; accept = [rec]; }
    return { rec, accept, raiseTo: clamp(raiseTo, Math.min(v.minTo, v.maxTo), v.maxTo), reason, concept, required, draws: dr, texture: tex };
  }

  // ---------- Coach ----------
  // The coach only ever receives a view from Game.coachView(seat): the acting player's
  // own cards plus public table information. It never sees other players' cards.

  const LEARN_RATE = 0.01;

  function Coach() { this.cache = new Map(); }

  Coach.prototype.equity = function (v) {
    const ranges = v.opponents.map(o => rangeFor(o.seat, v));
    const key = v.hole.slice().sort().join(',') + '|' + v.board.join(',') + '|' + ranges.map(r => r.toFixed(3)).join(',');
    let eq = this.cache.get(key);
    if (eq === undefined) {
      if (this.cache.size > 4000) this.cache.clear();
      eq = equity(v.hole, v.board, v.nOpp, 700, ranges);
      this.cache.set(key, eq);
    }
    return eq;
  };

  Coach.prototype.advise = function (v) {
    const eq = this.equity(v);
    const required = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const plan = v.street === 'preflop' ? preflopPlan(v) : postflopPlan(v, eq);
    return { ...plan, eq, required, evCall: eq * (v.pot + v.toCall) - v.toCall };
  };

  const LEAK = {
    looseFold: 'Plays too many hands preflop', tightFold: 'Folds playable hands preflop',
    foldOdds: 'Folds with the odds to call', callNoOdds: 'Calls without the odds',
    missValue: 'Misses value bets', weakRaise: 'Raises weak hands into bets', freeFold: 'Folds when checking is free',
  };

  Coach.prototype.review = function (v, d, adv) {
    const A = d.action, R = adv.rec, bb = v.bb, pre = v.street === 'preflop';
    const put = A === 'call' ? v.toCall : A === 'raise' ? d.raiseTo - v.myBet : 0;
    const word = a => a === 'raise' ? (v.toCall > 0 ? 'raise' : 'bet') : a;
    let grade = 'good', loss = 0, note, leak = null, concept = adv.concept;
    const lesson = [];

    if (adv.accept.includes(A)) {
      note = A === R ? adv.reason : `Fine. The coach prefers to ${word(R)}, but ${word(A)} is also part of a sound strategy here. ${adv.reason}`;
    } else if (A === 'fold' && v.toCall === 0) {
      grade = 'blunder'; loss = adv.eq * v.pot / bb; leak = LEAK.freeFold;
      note = 'You folded when checking was free. Never fold when nothing is owed.';
    } else if (pre) {
      if (A === 'fold') {
        loss = adv.handPct < 0.06 ? 3 : 0.6;
        grade = 'mistake'; leak = LEAK.tightFold;
        note = `Too tight. ${adv.reason}`;
        lesson.push(['openMult', 0.03]);
      } else if (R === 'fold') {
        loss = Math.min(put / bb, 6) * 0.35;
        grade = 'mistake'; leak = LEAK.looseFold;
        note = `Too loose. ${adv.reason}`;
        lesson.push(['openMult', -0.03]);
      } else {
        grade = 'ok';
        note = A === 'call' ? `A raise is better here. ${adv.reason}` : `A call is enough here. ${adv.reason}`;
        if (A === 'call') leak = LEAK.missValue;
      }
    } else if (A === 'fold') {
      loss = Math.max(0, adv.evCall) / bb;
      grade = loss > 6 ? 'blunder' : 'mistake'; leak = LEAK.foldOdds;
      note = `Folded with enough equity to continue. ${adv.reason}`;
      lesson.push(['callMargin', -LEARN_RATE]);
    } else if (A === 'call' && R === 'fold') {
      loss = Math.max(0, -adv.evCall) / bb;
      grade = loss > 6 ? 'blunder' : 'mistake'; leak = LEAK.callNoOdds;
      note = `Called without the odds. ${adv.reason}`;
      lesson.push(['callMargin', LEARN_RATE]);
    } else if ((A === 'call' || A === 'check') && R === 'raise') {
      grade = 'ok'; leak = LEAK.missValue;
      note = `Missed value. ${adv.reason}`;
      lesson.push(['raiseOffset', -LEARN_RATE / 2]);
    } else if (A === 'raise' && R === 'check') {
      grade = 'ok'; concept = 'valueBluff';
      note = d.intent === 'bluff'
        ? `A bluff. Fine now and then; a bet of this size needs to work about ${pct(put / (v.pot + put))} of the time to profit. ${adv.reason}`
        : `Betting a medium hand turns it into a bluff. ${adv.reason}`;
      lesson.push(d.intent === 'bluff' ? ['bluff', -LEARN_RATE / 4] : ['raiseOffset', LEARN_RATE / 2]);
    } else if (A === 'raise' && R === 'call') {
      grade = 'ok';
      note = `Raising is optional here; calling keeps weaker hands in. ${adv.reason}`;
      lesson.push(['raiseOffset', LEARN_RATE / 3]);
    } else { // raise facing a bet when the plan says fold
      const finalPot = v.pot + put + (d.raiseTo - v.currentBet);
      loss = Math.max(0, -(adv.eq * finalPot - put)) * 0.5 / bb; // half credit for fold equity
      grade = loss > 6 ? 'blunder' : 'mistake'; leak = LEAK.weakRaise;
      note = `Raised with a hand that should fold. ${adv.reason}`;
      lesson.push(d.intent === 'bluff' ? ['bluff', -LEARN_RATE / 2] : ['raiseOffset', LEARN_RATE]);
    }
    return { grade, loss: Math.round(loss * 10) / 10, note, lesson, leak, concept };
  };

  // Concept library the coach links its lessons to.
  const CONCEPTS = {
    position: { title: 'Position', text: 'Acting after your opponents shows you their move before you decide. Play more hands from the cutoff and button, fewer from early seats.' },
    ranges: { title: 'Ranges', text: 'Think in ranges: the set of hands a player could hold given their actions. Solver charts open about 15% of hands under the gun and over 40% on the button.' },
    potodds: { title: 'Pot odds', text: 'Divide the call by the pot after you call. Calling 20 to win 80 needs 25% equity. Call when your equity is higher.' },
    equity: { title: 'Equity', text: 'Your share of the pot if all cards were dealt out, measured against the hands your opponents likely hold.' },
    mdf: { title: 'Minimum defense frequency', text: 'Facing a bet B into a pot P, keep playing about P / (P + B) of your range or the bettor profits with any two cards. Half-pot bet: defend 67%. Pot-size bet: defend 50%.' },
    cbet: { title: 'Continuation bet', text: 'The preflop raiser can often bet small on dry, high-card flops because those boards hit the raiser\'s range more.' },
    sizing: { title: 'Bet sizing', text: 'Small bets (a third of the pot) suit dry boards and wide ranges. Larger bets (two thirds or more) suit wet boards and strong, polarized ranges.' },
    valueBluff: { title: 'Value and bluffs', text: 'A bluff needs folds as often as bet / (pot + bet). Rough balance: one bluff per three value bets at a third-pot size, one per one at pot size.' },
    draws: { title: 'Draws and outs', text: 'Outs are cards that make your hand. Rule of 2 and 4: outs × 2 is your chance on the next card, outs × 4 by the river from the flop.' },
    exploit: { title: 'GTO and exploits', text: 'GTO play is hard to beat but does not punish leaks. Against a player who calls too much, bluff less and bet bigger for value.' },
  };

  // ---------- Player agents ----------

  const PROFILES = [
    { name: 'Juno', style: 'Novice', openMult: 1.3, callMargin: 0.06, raiseOffset: 0.06, bluff: 0.10, aggr: 0.5, noise: 0.16 },
    { name: 'Mira', style: 'Tight-aggressive', openMult: 1.0, callMargin: 0.03, raiseOffset: 0.00, bluff: 0.08, aggr: 0.8, noise: 0.03 },
    { name: 'Dex', style: 'Loose-aggressive', openMult: 1.45, callMargin: -0.06, raiseOffset: -0.08, bluff: 0.25, aggr: 0.9, noise: 0.06 },
    { name: 'Otto', style: 'Calling station', openMult: 1.7, callMargin: -0.12, raiseOffset: 0.12, bluff: 0.02, aggr: 0.15, noise: 0.08 },
    { name: 'Rosa', style: 'Rock', openMult: 0.6, callMargin: 0.12, raiseOffset: 0.08, bluff: 0.01, aggr: 0.5, noise: 0.04 },
    { name: 'Kai', style: 'Maniac', openMult: 1.9, callMargin: -0.10, raiseOffset: -0.15, bluff: 0.40, aggr: 1.0, noise: 0.10 },
    { name: 'Theo', style: 'Balanced', openMult: 1.0, callMargin: 0.00, raiseOffset: 0.00, bluff: 0.10, aggr: 0.6, noise: 0.03 },
  ];
  const PARAM_RANGE = { openMult: [0.5, 2.2], callMargin: [-0.2, 0.25], raiseOffset: [-0.2, 0.25], bluff: [0, 0.5] };
  const PARAM_KEYS = ['openMult', 'callMargin', 'raiseOffset', 'bluff', 'aggr', 'noise'];

  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Player agents use the same strategy layer and the same limited view as the coach,
  // bent by their style and a noisier, cheaper equity read.
  function botDecide(v, prof) {
    const sizeOr = plan => ({ action: 'raise', raiseTo: plan.raiseTo });
    if (v.street === 'preflop') {
      const p = clamp(handPct(v.hole) / prof.openMult * Math.exp(gauss() * prof.noise * 2), 0, 1);
      const plan = preflopPlan(v, p);
      if (plan.rec === 'raise') return Math.random() < 0.35 + 0.65 * prof.aggr ? { ...sizeOr(plan), intent: 'value' } : { action: v.toCall ? 'call' : 'check' };
      if (plan.rec === 'fold' && v.canRaise && Math.random() < prof.bluff * 0.25) {
        return { action: 'raise', raiseTo: clamp(v.currentBet * 3, Math.min(v.minTo, v.maxTo), v.maxTo), intent: 'bluff' };
      }
      if (plan.rec === 'fold' && v.toCall > 0 && v.toCall <= BB && Math.random() < -prof.callMargin * 2) return { action: 'call' };
      return { action: plan.rec };
    }
    const ranges = v.opponents.map(o => rangeFor(o.seat, v));
    const est = clamp(equity(v.hole, v.board, v.nOpp, 160, ranges) + gauss() * prof.noise, 0, 1);
    const plan = postflopPlan(v, est);
    const required = v.toCall > 0 ? v.toCall / (v.pot + v.toCall) : 0;
    const valueT = valueThreshold(v.nOpp) + prof.raiseOffset;
    if (v.canRaise && est >= valueT && Math.random() < 0.45 + 0.55 * prof.aggr) {
      let to = v.toCall ? plan.raiseTo || v.currentBet * 3 : Math.round(v.pot * (0.33 + 0.5 * prof.aggr) / 10) * 10;
      if (est > 0.85 && Math.random() < prof.aggr * 0.25) to = v.maxTo;
      return { action: 'raise', raiseTo: clamp(to, Math.min(v.minTo, v.maxTo), v.maxTo), intent: 'value' };
    }
    if (v.toCall === 0) {
      if (plan.rec === 'raise' && v.canRaise && Math.random() < 0.5 + 0.5 * prof.aggr) return { ...sizeOr(plan), intent: plan.concept === 'cbet' ? 'cbet' : 'bluff' };
      const bluffP = prof.bluff * (v.street === 'river' ? 0.7 : 1);
      if (v.canRaise && Math.random() < bluffP) return { action: 'raise', raiseTo: clamp(Math.round(v.pot * 0.5 / 10) * 10, Math.min(v.minTo, v.maxTo), v.maxTo), intent: 'bluff' };
      return { action: 'check' };
    }
    if (est >= required + prof.callMargin) return { action: 'call' };
    if (v.canRaise && Math.random() < prof.bluff * 0.15) return { action: 'raise', raiseTo: clamp(v.currentBet * 3, Math.min(v.minTo, v.maxTo), v.maxTo), intent: 'bluff' };
    return { action: 'fold' };
  }

  // ---------- Game ----------

  function Game() {
    this.players = PROFILES.map((pr, seat) => ({
      seat, name: pr.name, style: pr.style,
      startProf: { ...pr },
      prof: Object.fromEntries(PARAM_KEYS.map(k => [k, pr[k]])),
      chips: START, rebuys: 0, hole: [], bet: 0, totalIn: 0,
      folded: false, allIn: false, acted: false, human: false, showed: false, vpipHand: false, pfrHand: false, lastAction: '',
      stats: { hands: 0, vpip: 0, pfr: 0, decisions: 0, good: 0, ok: 0, mistakes: 0, evLost: 0, trail: [], leaks: {}, concepts: {} },
    }));
    this.coach = new Coach();
    this.dealer = -1; this.handNo = 0; this.street = 'idle';
    this.board = []; this.deck = []; this.currentBet = 0; this.minRaise = BB; this.toAct = -1;
    this.actions = []; this.reviews = []; this.learning = true; this.lastResult = null; this.aggressor = -1;
    this.reviewSeq = 0;
  }

  const G = Game.prototype;
  G.N = PROFILES.length;
  G.pot = function () { return this.players.reduce((s, p) => s + p.totalIn, 0); };
  G.live = function () { return this.players.filter(p => !p.folded); };
  G.posOf = function (seat) { return POS_BY_OFFSET[(seat - this.dealer + this.N) % this.N]; };
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

  G.log = function (p, type, text, to) {
    this.actions.push({ seat: p.seat, name: p.name, street: this.street, type, to: to || 0, text: `${p.name} ${text}` });
  };

  G.startHand = function () {
    this.handNo++;
    for (const p of this.players) {
      if (p.chips < BB) { p.chips += START; p.rebuys++; }
      Object.assign(p, { hole: [], bet: 0, totalIn: 0, folded: false, allIn: false, acted: false, showed: false, vpipHand: false, pfrHand: false, lastAction: '' });
    }
    this.dealer = (this.dealer + 1) % this.N;
    this.deck = shuffledDeck();
    this.board = []; this.actions = []; this.lastResult = null; this.aggressor = -1;
    this.street = 'preflop'; this.currentBet = 0; this.minRaise = BB;
    for (let r = 0; r < 2; r++) for (let k = 1; k <= this.N; k++) this.players[(this.dealer + k) % this.N].hole.push(this.deck.pop());
    const sbSeat = (this.dealer + 1) % this.N, bbSeat = (this.dealer + 2) % this.N;
    const sbP = this.players[sbSeat], bbP = this.players[bbSeat];
    this.put(sbP, SB); sbP.lastAction = 'Small blind';
    this.put(bbP, BB); bbP.lastAction = 'Big blind';
    this.currentBet = BB;
    this.log(sbP, 'post', `posts ${SB}`); this.log(bbP, 'post', `posts ${BB}`);
    this.toAct = this.findNext(bbSeat);
  };

  // Everything the acting player can legally know. This is the only input to the coach and bots.
  G.coachView = function (seat) {
    const p = this.players[seat];
    const toCall = Math.min(this.currentBet - p.bet, p.chips);
    const others = this.players.filter(q => q !== p && !q.folded);
    const maxTo = p.bet + p.chips;
    const posOf = {};
    for (const q of this.players) posOf[q.seat] = this.posOf(q.seat);
    return {
      seat, hand: this.handNo, street: this.street, bb: BB, pos: posOf[seat], posOf,
      hole: p.hole.slice(), board: this.board.slice(),
      pot: this.pot(), toCall, myBet: p.bet, stack: p.chips,
      currentBet: this.currentBet, minRaise: this.minRaise,
      minTo: this.currentBet + this.minRaise, maxTo,
      canRaise: maxTo > this.currentBet && others.some(canAct),
      nOpp: others.length, aggressor: this.aggressor,
      opponents: others.map(q => ({ seat: q.seat, name: q.name, stack: q.chips, bet: q.bet, allIn: q.allIn, pos: posOf[q.seat] })),
      actions: this.actions.map(a => ({ seat: a.seat, street: a.street, type: a.type, to: a.to })),
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
      this.aggressor = p.seat;
      for (const q of this.players) if (q !== p) q.acted = false;
      text = (wasBet ? 'bets ' : 'raises to ') + p.bet + (p.allIn ? ' (all-in)' : '');
      if (this.street === 'preflop') p.pfrHand = true;
    }
    p.acted = true;
    if (this.street === 'preflop' && (dec.action === 'call' || dec.action === 'raise')) p.vpipHand = true;
    p.lastAction = cap(text);
    this.log(p, dec.action, text, dec.action === 'raise' ? p.bet : 0);
    return text;
  };

  G.record = function (p, v, dec, adv, rev, text) {
    const s = p.stats;
    s.decisions++;
    if (rev.grade === 'good') s.good++;
    else if (rev.grade === 'ok') s.ok++;
    else s.mistakes++;
    s.evLost += rev.loss;
    const pts = rev.grade === 'good' ? 1 : rev.grade === 'ok' ? 0.5 : 0;
    s.trail.push(pts);
    if (s.trail.length > 400) s.trail.shift();
    if (rev.leak && rev.grade !== 'good') s.leaks[rev.leak] = (s.leaks[rev.leak] || 0) + 1;
    const cs = s.concepts[rev.concept] || (s.concepts[rev.concept] = { n: 0, pts: 0 });
    cs.n++; cs.pts += pts;
    if (this.learning && !p.human) {
      for (const [param, delta] of rev.lesson) {
        const [lo, hi] = PARAM_RANGE[param];
        p.prof[param] = clamp(param === 'openMult' ? p.prof[param] * (1 + delta) : p.prof[param] + delta, lo, hi);
      }
      p.prof.noise = Math.max(0.01, p.prof.noise * 0.997); // practice sharpens reads
    }
    const r = {
      id: ++this.reviewSeq, hand: v.hand, street: v.street, seat: p.seat, name: p.name, human: p.human,
      view: v, decision: dec, actionText: text, rec: adv.rec, accept: adv.accept, recTo: adv.raiseTo,
      eq: adv.eq, required: adv.required, grade: rev.grade, loss: rev.loss, note: rev.note, leak: rev.leak, concept: rev.concept,
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
      if (p.pfrHand) p.stats.pfr++;
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

  // Hero's current made hand and draws, for the player's own display.
  function describeHand(hole, board) {
    if (board.length < 3) return `${handKey(hole)} · top ${pct(handPct(hole))} of starting hands`;
    const d = draws(hole, board);
    return categoryName(score(hole.concat(board))) + (d.names.length ? ' + ' + d.names.join(' + ') : '');
  }

  // Parse cards like "AsKd", "Ah 10c", "qh7c2d" into card ints. Throws on bad or duplicate cards.
  function parseCards(str) {
    const t = String(str || '').replace(/10/g, 'T').replace(/[\s,]+/g, '');
    if (t.length % 2) throw new Error(`Cannot read cards "${str}". Use rank + suit, e.g. AsKd.`);
    const out = [];
    for (let i = 0; i < t.length; i += 2) {
      const r = RANKS.indexOf(t[i].toUpperCase()), s = SUIT_LETTERS.indexOf(t[i + 1].toLowerCase());
      if (r < 0 || s < 0) throw new Error(`Cannot read card "${t.slice(i, i + 2)}". Ranks 2-9 T J Q K A, suits s h d c.`);
      const c = r * 4 + s;
      if (out.includes(c)) throw new Error(`Card ${t.slice(i, i + 2)} appears twice.`);
      out.push(c);
    }
    return out;
  }

  // A concrete two-card hand for a class like "AJo", "T9s" or "77".
  function holeFromKey(key) {
    const k = String(key || '').trim();
    if (/^[2-9TJQKA]{2}[so]?$/i.test(k)) {
      const a = RANKS.indexOf(k[0].toUpperCase()), b = RANKS.indexOf(k[1].toUpperCase());
      const suited = a !== b && (k[2] || 'o').toLowerCase() === 's';
      return [a * 4, b * 4 + (suited ? 0 : 1)];
    }
    const cards = parseCards(k);
    if (cards.length !== 2) throw new Error(`Give a hand like "AJo", "T9s", "77" or "AsJd".`);
    return cards;
  }

  // Compact one-line summary of a decision for an LLM prompt (token-lean by design).
  function viewSummary(r) {
    const v = r.view;
    const cards = a => a.map(cardText).join('') || '-';
    const opp = v.opponents.map(o => `${o.name}(${o.pos}) ${o.stack}${o.allIn ? ' all-in' : ''}`).join(', ');
    return [
      `Hand ${v.hand} ${v.street}, blinds ${SB}/${BB}`,
      `hero ${v.pos} ${cards(v.hole)}`,
      `board ${cards(v.board)}`,
      `pot ${v.pot}, to call ${v.toCall}, stack ${v.stack}`,
      `opp: ${opp}`,
      `history: ${v.history.slice(-6).join('; ')}`,
      `decision: ${r.actionText}`,
      `coach: ${r.grade}, prefers ${r.rec}, equity vs ranges ${pct(r.eq)}`,
    ].join(' | ');
  }

  const API = {
    RANKS, SUIT_GLYPHS, SB, BB, START, CATEGORIES, PROFILES, CONCEPTS, POS_NAMES, OPEN,
    rankOf, suitOf, cardText, score, categoryName, equity, handKey, handPct, texture, draws, rangeFor,
    preflopPlan, postflopPlan, describeHand, parseCards, holeFromKey, Coach, Game, viewSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Poker = API;
})(typeof window !== 'undefined' ? window : globalThis);
