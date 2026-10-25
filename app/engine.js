// No-Limit Hold'em engine: cards, hand evaluator, betting, side pots, showdown.
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

  // A card is rank * 4 + suit, with rank 2..14 and suit 0..3.
  const makeCard = (r, s) => r * 4 + s;
  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const cardStr = (c) => RANKS[rankOf(c) - 2] + SUITS[suitOf(c)];
  const parseCard = (str) => makeCard(RANKS.indexOf(str[0].toUpperCase()) + 2, SUITS.indexOf(str[1].toLowerCase()));

  function fullDeck() {
    const d = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) d.push(makeCard(r, s));
    return d;
  }

  function shuffle(a, rng = Math.random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- Hand evaluator: higher number = better hand. Works for 5 to 7 cards.
  function straightHigh(mask) {
    if (mask & (1 << 14)) mask |= 1 << 1; // ace plays low in the wheel
    for (let h = 14; h >= 5; h--) {
      const need = 0b11111 << (h - 4);
      if ((mask & need) === need) return h;
    }
    return 0;
  }

  function topRanks(mask, n, exclude) {
    const out = [];
    for (let r = 14; r >= 2 && out.length < n; r--) if ((mask >> r) & 1 && !exclude.includes(r)) out.push(r);
    return out;
  }

  function score(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 15 + (ks[i] || 0);
    return v;
  }

  function evaluate(cards) {
    const rc = new Array(15).fill(0);
    const sc = [0, 0, 0, 0];
    const sm = [0, 0, 0, 0];
    let mask = 0;
    for (const c of cards) {
      const r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sf = straightHigh(sm[flushSuit]);
      if (sf) return score(8, [sf]);
    }
    let quad = 0;
    const trips = [], pairs = [];
    for (let r = 14; r >= 2; r--) {
      if (rc[r] === 4) quad = r;
      else if (rc[r] === 3) trips.push(r);
      else if (rc[r] === 2) pairs.push(r);
    }
    if (quad) return score(7, [quad, topRanks(mask, 1, [quad])[0]]);
    if (trips.length && (trips.length > 1 || pairs.length)) return score(6, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
    if (flushSuit >= 0) return score(5, topRanks(sm[flushSuit], 5, []));
    const st = straightHigh(mask);
    if (st) return score(4, [st]);
    if (trips.length) return score(3, [trips[0], ...topRanks(mask, 2, [trips[0]])]);
    if (pairs.length >= 2) return score(2, [pairs[0], pairs[1], topRanks(mask, 1, [pairs[0], pairs[1]])[0]]);
    if (pairs.length) return score(1, [pairs[0], ...topRanks(mask, 3, [pairs[0]])]);
    return score(0, topRanks(mask, 5, []));
  }

  const handName = (v) => HAND_NAMES[Math.floor(v / 759375)]; // 15^5

  // ---- Side pots from each player's total contribution this hand.
  function computePots(players) {
    const levels = [...new Set(players.filter((p) => !p.folded && p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      for (const p of players) amount += Math.max(0, Math.min(p.total, L) - prev);
      const eligible = players.map((_, i) => i).filter((i) => !players[i].folded && players[i].total >= L);
      if (amount > 0) pots.push({ amount, eligible });
      prev = L;
    }
    let rest = 0; // dead money above the top live contribution
    for (const p of players) rest += Math.max(0, p.total - prev);
    if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
    return pots;
  }

  class Table {
    constructor(opts = {}) {
      this.smallBlind = opts.smallBlind || 10;
      this.bigBlind = opts.bigBlind || 20;
      this.startStack = opts.startStack || 2000;
      this.rng = opts.rng || Math.random;
      this.players = [];
      this.dealer = -1;
      this.handNo = 0;
      this.handOver = true;
      this.board = [];
      this.actions = [];
      this.result = null;
      this.street = 'preflop';
      this.currentBet = 0;
      this.minRaise = this.bigBlind;
      this.toAct = -1;
    }

    addPlayer(info) {
      this.players.push(Object.assign({ stack: this.startStack, rebuys: 0, sittingOut: false }, info, {
        hole: [], inHand: false, folded: true, allIn: false, bet: 0, total: 0, acted: false, lastAction: '',
      }));
      return this.players.length - 1;
    }

    seatsInHand() { return this.players.map((_, i) => i).filter((i) => this.players[i].inHand); }

    nextFrom(i, pred) {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const j = (((i + k) % n) + n) % n;
        if (pred(this.players[j], j)) return j;
      }
      return -1;
    }

    pot() { return this.players.reduce((s, p) => s + p.total, 0); }

    post(seat, amount) {
      const p = this.players[seat];
      const a = Math.min(amount, p.stack);
      p.stack -= a; p.bet += a; p.total += a;
      if (p.stack === 0) p.allIn = true;
    }

    startHand() {
      for (const p of this.players) {
        if (!p.sittingOut && p.stack <= 0) { p.stack = this.startStack; p.rebuys++; }
        p.inHand = !p.sittingOut;
        p.folded = !p.inHand;
        p.allIn = false; p.bet = 0; p.total = 0; p.acted = false; p.hole = []; p.lastAction = '';
      }
      const seats = this.seatsInHand();
      if (seats.length < 2) return false;
      this.handNo++;
      this.handOver = false;
      this.result = null;
      this.board = [];
      this.actions = [];
      this.street = 'preflop';
      this.dealer = this.nextFrom(this.dealer, (p) => p.inHand);
      this.deck = shuffle(fullDeck(), this.rng);
      for (let r = 0; r < 2; r++) for (const i of seats) this.players[i].hole.push(this.deck.pop());
      this.sbSeat = seats.length === 2 ? this.dealer : this.nextFrom(this.dealer, (p) => p.inHand);
      this.bbSeat = this.nextFrom(this.sbSeat, (p) => p.inHand);
      this.post(this.sbSeat, this.smallBlind);
      this.post(this.bbSeat, this.bigBlind);
      this.players[this.sbSeat].lastAction = 'SB';
      this.players[this.bbSeat].lastAction = 'BB';
      this.currentBet = this.bigBlind;
      this.minRaise = this.bigBlind;
      this.settle(this.bbSeat);
      return true;
    }

    needsAction(p) {
      if (!p.inHand || p.folded || p.allIn) return false;
      const others = this.players.some((q) => q !== p && q.inHand && !q.folded && !q.allIn);
      if (!others && p.bet >= this.currentBet) return false;
      return !p.acted || p.bet < this.currentBet;
    }

    settle(fromSeat) {
      const live = this.players.filter((p) => p.inHand && !p.folded);
      if (live.length === 1) return this.finish();
      const next = this.nextFrom(fromSeat, (p) => this.needsAction(p));
      if (next >= 0) { this.toAct = next; return; }
      this.nextStreet();
    }

    nextStreet() {
      for (const p of this.players) { p.bet = 0; p.acted = false; }
      this.currentBet = 0;
      this.minRaise = this.bigBlind;
      if (this.street === 'river') return this.finish();
      if (this.street === 'preflop') { this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); this.street = 'flop'; }
      else if (this.street === 'flop') { this.board.push(this.deck.pop()); this.street = 'turn'; }
      else { this.board.push(this.deck.pop()); this.street = 'river'; }
      this.settle(this.dealer);
    }

    legal(seat) {
      const p = this.players[seat];
      const toCall = Math.min(this.currentBet - p.bet, p.stack);
      const maxRaiseTo = p.bet + p.stack;
      const othersCanAct = this.players.some((q) => q !== p && q.inHand && !q.folded && !q.allIn);
      return {
        toCall,
        canCheck: toCall === 0,
        canRaise: othersCanAct && maxRaiseTo > this.currentBet,
        minRaiseTo: Math.min(this.currentBet + this.minRaise, maxRaiseTo),
        maxRaiseTo,
      };
    }

    act(seat, type, amount) {
      if (this.handOver || seat !== this.toAct) throw new Error(`Seat ${seat} cannot act now`);
      const p = this.players[seat];
      const L = this.legal(seat);
      if (type === 'raise' && !L.canRaise) type = L.toCall > 0 ? 'call' : 'check';
      if (type === 'call' && L.toCall === 0) type = 'check';
      if (type === 'check' && L.toCall > 0) throw new Error('Cannot check facing a bet');
      const wasBet = this.currentBet;
      if (type === 'fold') {
        p.folded = true;
        p.lastAction = 'Fold';
      } else if (type === 'check') {
        p.lastAction = 'Check';
      } else if (type === 'call') {
        this.post(seat, L.toCall);
        p.lastAction = `Call ${L.toCall}`;
      } else if (type === 'raise') {
        const to = Math.max(L.minRaiseTo, Math.min(Math.round(amount) || 0, L.maxRaiseTo));
        const raiseSize = to - this.currentBet;
        this.post(seat, to - p.bet);
        if (raiseSize >= this.minRaise) {
          this.minRaise = raiseSize;
          for (const q of this.players) if (q !== p) q.acted = false;
        }
        this.currentBet = Math.max(this.currentBet, p.bet);
        p.lastAction = `${wasBet === 0 ? 'Bet' : 'Raise to'} ${p.bet}`;
      } else {
        throw new Error(`Unknown action ${type}`);
      }
      if (p.allIn && type !== 'fold') p.lastAction += ' (all-in)';
      p.acted = true;
      const amt = type === 'call' ? L.toCall : type === 'raise' ? p.bet : 0;
      this.actions.push({ seat, street: this.street, type, amount: amt, allIn: p.allIn });
      this.settle(seat);
    }

    finish() {
      this.handOver = true;
      this.toAct = -1;
      const n = this.players.length;
      const live = this.players.map((_, i) => i).filter((i) => this.players[i].inHand && !this.players[i].folded);
      const winnings = new Array(n).fill(0);
      const hands = {};
      const showdown = live.length > 1;
      if (!showdown) {
        winnings[live[0]] = this.pot();
      } else {
        for (const i of live) hands[i] = evaluate(this.players[i].hole.concat(this.board));
        const fromDealer = (i) => (i - this.dealer - 1 + n) % n;
        for (const pot of computePots(this.players)) {
          const best = Math.max(...pot.eligible.map((i) => hands[i]));
          const winners = pot.eligible.filter((i) => hands[i] === best).sort((a, b) => fromDealer(a) - fromDealer(b));
          const share = Math.floor(pot.amount / winners.length);
          let rem = pot.amount - share * winners.length;
          for (const w of winners) { winnings[w] += share + (rem > 0 ? 1 : 0); rem--; }
        }
      }
      winnings.forEach((w, i) => { this.players[i].stack += w; });
      this.result = {
        showdown,
        live,
        winnings,
        hands: live.map((i) => ({ seat: i, name: showdown ? handName(hands[i]) : '' })),
      };
    }

    positionLabel(seat) {
      if (seat === this.dealer) return 'BTN';
      if (seat === this.sbSeat) return 'SB';
      if (seat === this.bbSeat) return 'BB';
      const order = [];
      for (let i = this.nextFrom(this.bbSeat, (p) => p.inHand); i !== this.dealer && i >= 0; i = this.nextFrom(i, (p) => p.inHand)) order.push(i);
      const idx = order.indexOf(seat);
      if (idx === order.length - 1) return 'CO';
      return idx < order.length / 2 ? 'EP' : 'MP';
    }

    // Everything the acting player is allowed to know: own cards plus public info.
    // The coach and the bots read only this. Other players' hole cards never appear here.
    coachView(seat) {
      const p = this.players[seat];
      const L = this.legal(seat);
      return {
        seat,
        name: p.name,
        hole: p.hole.slice(),
        board: this.board.slice(),
        street: this.street,
        position: this.positionLabel(seat),
        pot: this.pot(),
        toCall: L.toCall,
        myBet: p.bet,
        stack: p.stack,
        currentBet: this.currentBet,
        canRaise: L.canRaise,
        minRaiseTo: L.minRaiseTo,
        maxRaiseTo: L.maxRaiseTo,
        bigBlind: this.bigBlind,
        opponents: this.players
          .map((q, i) => ({ q, i }))
          .filter(({ q, i }) => i !== seat && q.inHand && !q.folded)
          .map(({ q, i }) => ({ seat: i, name: q.name, stack: q.stack, bet: q.bet, allIn: q.allIn })),
        actions: this.actions.map((a) => Object.assign({}, a)),
      };
    }
  }

  const api = { RANKS, SUITS, HAND_NAMES, makeCard, rankOf, suitOf, cardStr, parseCard, fullDeck, shuffle, evaluate, handName, computePots, Table };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEngine = api;
})(this);
