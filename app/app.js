// UI and game loop. Seat 0 is you; seats 1-7 are the AI players.
(function () {
  'use strict';

  const { Table, rankOf, suitOf } = PokerEngine;
  const Coach = PokerCoach;
  const Bots = PokerBots;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (x) => Math.round(x * 100) + '%';
  const BAD = ['Mistake', 'Blunder'];
  const HERO = 0;
  const STORE_KEY = 'poker-coach-mistakes-v1';

  const table = new Table({ smallBlind: 10, bigBlind: 20, startStack: 2000 });
  table.addPlayer({ name: 'You', style: 'Human', isHuman: true, sittingOut: true });
  for (const s of Bots.STYLES) {
    table.addPlayer({ name: s.name, style: s.style, blurb: s.blurb, params: Object.assign({}, s.params), startParams: Object.assign({}, s.params) });
  }

  const state = {
    paused: true,
    waiters: [],
    speed: 600,
    showCards: false,
    learning: true,
    feedFilter: 'all',
    heroAnalysis: null,
    heroResolve: null,
    lastHero: null,
    feed: [],
    stats: table.players.map(() => ({ decisions: 0, mistakes: 0, lossBB: 0 })),
    mistakes: loadMistakes(),
    drill: null,
    drillScore: { tried: 0, right: 0 },
  };

  // ---- Persistence (mistakes only; best effort)
  function loadMistakes() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function saveMistakes() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.mistakes.slice(0, 100))); } catch (e) { /* storage unavailable */ }
  }

  // ---- Game loop
  function waitRunning() {
    return state.paused ? new Promise((r) => state.waiters.push(r)) : Promise.resolve();
  }
  function setPaused(v) {
    state.paused = v;
    if (!v) state.waiters.splice(0).forEach((r) => r());
    renderTopbar();
  }

  async function loop() {
    for (;;) {
      await waitRunning();
      if (!table.startHand()) { setPaused(true); continue; }
      render();
      while (!table.handOver) {
        await waitRunning();
        const seat = table.toAct;
        const p = table.players[seat];
        if (p.isHuman && p.sittingOut) { table.act(seat, 'fold'); render(); continue; }
        const analysis = Coach.analyze(table.coachView(seat));
        let decision;
        if (p.isHuman) {
          decision = await heroTurn(analysis);
          if (!decision) { table.act(seat, 'fold'); render(); continue; } // left the seat
        } else {
          const heroWatching = !table.players[HERO].sittingOut && !table.players[HERO].folded;
          await sleep(heroWatching ? state.speed : state.speed * 0.6);
          decision = Bots.decide(analysis, p.params);
        }
        record(seat, analysis, decision);
        table.act(seat, decision.type, decision.amount);
        render();
      }
      render();
      await sleep(Math.max(1200, state.speed * 3));
    }
  }

  function heroTurn(analysis) {
    state.heroAnalysis = analysis;
    $('#hint').hidden = true;
    renderHero();
    return new Promise((resolve) => { state.heroResolve = resolve; });
  }

  function heroAct(type, amount) {
    if (!state.heroResolve) return;
    const resolve = state.heroResolve;
    state.heroResolve = null;
    state.heroAnalysis = null;
    $('#hint').hidden = true;
    resolve(type ? { type, amount } : null);
  }

  function record(seat, a, d) {
    const p = table.players[seat];
    const g = Coach.grade(a, d);
    const st = state.stats[seat];
    st.decisions++;
    st.lossBB += g.lossBB;
    if (BAD.includes(g.grade)) st.mistakes++;
    const learned = !p.isHuman && state.learning ? Bots.learn(p, g) : null;
    const entry = {
      hand: table.handNo, seat, name: p.name, street: a.view.street, action: Coach.describe(d, a.view),
      grade: g.grade, lossBB: g.lossBB, lesson: g.lesson, learned, me: !!p.isHuman,
      hole: p.isHuman ? a.view.hole : null,
    };
    state.feed.unshift(entry);
    if (state.feed.length > 200) state.feed.pop();
    if (p.isHuman) {
      state.lastHero = entry;
      if (BAD.includes(g.grade)) {
        const v = a.view;
        state.mistakes.unshift({
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          hole: v.hole, board: v.board, street: v.street, position: v.position, pot: v.pot, toCall: v.toCall,
          currentBet: v.currentBet, stack: v.stack, nEff: a.nEff, equity: a.equity, potOdds: a.potOdds,
          chosen: entry.action, chosenType: d.type, best: Coach.describe(a.best, v), bestType: a.best.type,
          options: a.options.map((o) => ({ type: o.type, amount: o.amount, ev: o.ev })),
          lossBB: g.lossBB, grade: g.grade, lesson: g.lesson, tries: 0, right: 0,
        });
        saveMistakes();
      }
    }
  }

  // ---- Rendering helpers
  function cardHTML(c, cls = '') {
    if (c == null) return `<span class="card back ${cls}"></span>`;
    const r = ' 23456789TJQKA'[rankOf(c) - 1];
    const s = suitOf(c);
    const sym = ['♠', '♥', '♦', '♣'][s];
    return `<span class="card ${cls} ${s === 1 || s === 2 ? 'red' : ''}">${r === 'T' ? '10' : r}<span class="s">${sym}</span></span>`;
  }

  function seatPos(i, n, rx, ry) {
    const ang = Math.PI / 2 + (i * 2 * Math.PI) / n; // seat 0 at the bottom centre
    return { x: 50 + rx * Math.cos(ang), y: 50 + ry * Math.sin(ang) };
  }

  function render() {
    renderTable();
    renderHero();
    renderFeed();
    renderPlayers();
    renderTopbar();
  }

  function renderTopbar() {
    $('#btn-run').textContent = state.paused ? (table.handNo ? 'Resume' : 'Deal') : 'Pause';
    $('#btn-seat').textContent = table.players[HERO].sittingOut ? 'Take a seat' : 'Leave seat';
  }

  function renderTable() {
    const el = $('#table');
    el.querySelectorAll('.seat, .bet').forEach((n) => n.remove());
    const n = table.players.length;
    const res = table.result;
    const winners = res ? new Set(res.winnings.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0)) : new Set();
    table.players.forEach((p, i) => {
      const narrow = window.innerWidth < 640;
      const pos = seatPos(i, n, narrow ? 38 : 44, narrow ? 36 : 42);
      const reveal = p.isHuman || state.showCards || (res && res.showdown && res.live.includes(i));
      const cards = p.hole.length && p.inHand && !(p.folded && !p.isHuman) ? p.hole.map((c) => cardHTML(reveal ? c : null, 'sm')).join('') : '';
      const cls = ['seat', p.isHuman ? 'hero' : '', p.sittingOut ? 'out' : '', p.folded && p.inHand ? 'folded' : '', table.toAct === i ? 'to-act' : '', winners.has(i) ? 'winner' : ''].join(' ');
      const div = document.createElement('div');
      div.className = cls;
      div.style.left = pos.x + '%';
      div.style.top = pos.y + '%';
      div.title = p.blurb || '';
      div.innerHTML = `
        ${table.dealer === i && p.inHand ? '<span class="dealer">D</span>' : ''}
        <div class="name">${esc(p.name)}</div>
        <div class="style">${esc(p.sittingOut && p.isHuman ? 'Empty seat' : p.style)}</div>
        <div class="cards">${cards}</div>
        <div class="stack">${p.stack.toLocaleString()}</div>
        <div class="last">${esc(res && res.winnings[i] ? `Wins ${res.winnings[i]}` : p.lastAction)}</div>`;
      el.appendChild(div);
      if (p.bet > 0) {
        const b = seatPos(i, n, 27, 22);
        const chip = document.createElement('div');
        chip.className = 'bet';
        chip.style.left = b.x + '%';
        chip.style.top = b.y + '%';
        chip.textContent = p.bet;
        el.appendChild(chip);
      }
    });
    $('#board').innerHTML = table.board.map((c) => cardHTML(c)).join('');
    $('#street').textContent = table.handNo ? `Hand #${table.handNo} · ${table.street}` : '';
    $('#pot').textContent = table.handNo ? `Pot ${table.pot().toLocaleString()}` : '';
    let msg = '';
    if (!table.handNo) msg = 'Press Deal to watch the AI players, or take a seat to play and be coached.';
    else if (res) {
      msg = res.winnings
        .map((w, i) => (w > 0 ? `${table.players[i].name} wins ${w}${res.showdown ? ' with ' + res.hands.find((h) => h.seat === i).name.toLowerCase() : ''}` : null))
        .filter(Boolean).join(' · ');
    }
    $('#message').textContent = msg;
  }

  function renderHero() {
    const a = state.heroAnalysis;
    const hero = table.players[HERO];
    const status = $('#hero-status');
    const buttons = ['#act-fold', '#act-call', '#act-raise', '#act-hint'].map((s) => $(s));
    if (!a) {
      buttons.forEach((b) => { b.disabled = true; });
      $('#raise-row').hidden = true;
      status.textContent = hero.sittingOut
        ? 'You are watching. Take a seat to play; the coach grades every decision you make.'
        : hero.folded || !hero.inHand ? 'Waiting for the next hand…' : 'Waiting for your turn…';
    } else {
      const v = a.view;
      status.innerHTML = `<b>Your turn</b> (${esc(v.position)}) · pot ${v.pot} · ${v.toCall ? `to call ${v.toCall}` : 'no bet to you'} · stack ${v.stack}`;
      $('#act-fold').disabled = v.toCall === 0;
      $('#act-call').disabled = false;
      $('#act-call').textContent = v.toCall ? `Call ${v.toCall}` : 'Check';
      $('#act-hint').disabled = false;
      $('#act-raise').disabled = !v.canRaise;
      $('#raise-row').hidden = !v.canRaise;
      if (v.canRaise) {
        const range = $('#raise-amt'), num = $('#raise-num');
        range.min = num.min = v.minRaiseTo;
        range.max = num.max = v.maxRaiseTo;
        if (!range.dataset.hand || range.dataset.hand !== `${table.handNo}-${table.actions.length}`) {
          range.dataset.hand = `${table.handNo}-${table.actions.length}`;
          setRaise(a.raiseTo);
        }
      }
    }
    const lg = $('#last-grade');
    if (state.lastHero) {
      const e = state.lastHero;
      lg.hidden = false;
      lg.innerHTML = `Last decision (${esc(e.street)}): ${esc(e.action)} · <span class="badge ${e.grade}">${e.grade}</span>${e.lossBB > 0.05 ? ` (−${e.lossBB.toFixed(1)} BB)` : ''}<div>${esc(e.lesson)}</div>`;
    } else lg.hidden = true;
  }

  function setRaise(x) {
    const a = state.heroAnalysis;
    if (!a) return;
    const v = a.view;
    const to = Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, Math.round(x)));
    $('#raise-amt').value = to;
    $('#raise-num').value = to;
    $('#act-raise').textContent = `${v.currentBet === 0 ? 'Bet' : 'Raise to'} ${to}${to === v.maxRaiseTo ? ' (all-in)' : ''}`;
  }

  function renderFeed() {
    const f = state.feedFilter;
    const items = state.feed.filter((e) => f === 'all' || (f === 'me' && e.me) || (f === 'bad' && BAD.includes(e.grade))).slice(0, 80);
    $('#feed').innerHTML = items.length
      ? items.map((e) => `
        <li class="entry ${e.grade} ${e.me ? 'me' : ''}">
          <div class="head"><span><span class="who">${esc(e.name)}</span> · #${e.hand} ${esc(e.street)} · ${esc(e.action)}</span>
            <span class="badge ${e.grade}">${e.grade}${e.lossBB > 0.05 ? ` −${e.lossBB.toFixed(1)}` : ''}</span></div>
          <div class="lesson">${e.hole ? `<span class="spot-cards">${e.hole.map((c) => cardHTML(c, 'xs')).join('')}</span>` : ''}${esc(e.lesson)}</div>
          ${e.learned ? `<div class="learned">↻ ${esc(e.learned)}</div>` : ''}
        </li>`).join('')
      : '<li class="note">Coach notes appear here as hands are played.</li>';
  }

  function renderPlayers() {
    if ($('#tab-players').hidden) return;
    const names = { callMargin: 'call margin', raiseThreshold: 'raise bar', bluffRate: 'bluff rate', readError: 'read error' };
    $('#players').innerHTML = table.players.map((p, i) => {
      const st = state.stats[i];
      const net = p.stack - (1 + p.rebuys) * table.startStack;
      const params = p.params
        ? Object.keys(names).map((k) => {
          const d = p.params[k] - p.startParams[k];
          const arrow = Math.abs(d) < 0.0005 ? '' : d > 0 ? ' ▲' : ' ▼';
          return `${names[k]} ${p.params[k].toFixed(2)}${arrow}`;
        }).join(' · ')
        : '';
      return `<div class="pcard">
        <div class="row"><b>${esc(p.name)}</b><span class="muted">${esc(p.style)}</span></div>
        <div class="row"><span>Stack ${p.stack.toLocaleString()}</span><span class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${net.toLocaleString()}${p.rebuys ? ` (${p.rebuys} rebuy${p.rebuys > 1 ? 's' : ''})` : ''}</span></div>
        <div class="row muted"><span>${st.decisions} decisions</span><span>${st.decisions ? Math.round((100 * st.mistakes) / st.decisions) : 0}% mistakes · avg −${st.decisions ? (st.lossBB / st.decisions).toFixed(2) : '0.00'} BB</span></div>
        ${params ? `<div class="params">${params}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ---- Drills: replay your own mistakes until you get them right
  function renderDrills() {
    const m = state.mistakes;
    const s = state.drillScore;
    $('#drill-summary').textContent = m.length
      ? `${m.length} saved mistake${m.length > 1 ? 's' : ''}. Drills this session: ${s.right}/${s.tried} correct.`
      : 'No mistakes saved yet. Take a seat and play; every Mistake or Blunder you make is saved here as a drill.';
    const d = state.drill;
    const box = $('#drill');
    if (!m.length) { box.innerHTML = ''; }
    else if (!d) { box.innerHTML = '<button class="primary" id="drill-start">Start a drill</button>'; }
    else {
      const spot = d.spot;
      const choices = spot.toCall > 0 ? [['fold', 'Fold'], ['call', `Call ${spot.toCall}`]] : [['check', 'Check']];
      if (spot.options.some((o) => o.type === 'raise')) choices.push(['raise', spot.currentBet === 0 ? 'Bet' : 'Raise']);
      box.innerHTML = `
        <div><b>${esc(spot.street)}</b> · ${esc(spot.position)} · vs ${spot.nEff} opponent${spot.nEff > 1 ? 's' : ''}</div>
        <div class="spot"><span class="spot-cards">${spot.hole.map((c) => cardHTML(c, 'sm')).join('')}</span>
          <span class="spot-cards">${spot.board.length ? spot.board.map((c) => cardHTML(c, 'sm')).join('') : '<span class="facts">no board yet</span>'}</span></div>
        <div class="facts">Pot ${spot.pot} · ${spot.toCall ? `to call ${spot.toCall}` : 'checked to you'} · stack ${spot.stack}</div>
        <div class="choices">${choices.map(([t, l]) => `<button data-drill="${t}" ${d.answer ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>
        ${d.answer ? `<div class="reveal"><span class="badge ${d.answer === spot.bestType ? 'Good' : 'Blunder'}">${d.answer === spot.bestType ? 'Correct' : 'Not quite'}</span>
          Coach's play: <b>${esc(spot.best)}</b>. Equity ${pct(spot.equity)}${spot.toCall ? `, needed ${pct(spot.potOdds)}` : ''}.
          <div class="facts">EV vs folding: ${spot.options.map((o) => `${o.type} ${(o.ev / table.bigBlind).toFixed(1)} BB`).join(' · ')}</div>
          <div>${esc(spot.lesson)}</div>
          <div class="choices"><button class="primary" id="drill-next">Next drill</button></div></div>` : ''}`;
    }
    $('#mistakes').innerHTML = m.slice(0, 40).map((x) => `
      <li class="entry ${x.grade}">
        <div class="head"><span><span class="spot-cards">${x.hole.map((c) => cardHTML(c, 'xs')).join('')}</span>${esc(x.street)} · ${esc(x.chosen)}</span>
          <span><span class="badge ${x.grade}">−${x.lossBB.toFixed(1)}</span> <button data-del="${esc(x.id)}" title="Remove">✕</button></span></div>
        <div class="lesson">${esc(x.lesson)}</div>
        ${x.tries ? `<div class="learned">Drilled ${x.right}/${x.tries}</div>` : ''}
      </li>`).join('');
  }

  function nextDrill() {
    const m = state.mistakes;
    if (!m.length) { state.drill = null; return; }
    // Favour spots you have not mastered yet.
    const weights = m.map((x) => 1 / (1 + 2 * x.right) + x.lossBB / 20);
    let r = Math.random() * weights.reduce((s, w) => s + w, 0);
    let i = 0;
    while (r > weights[i] && i < m.length - 1) r -= weights[i++];
    state.drill = { spot: m[i], answer: null };
  }

  // ---- Wiring
  $('#btn-run').addEventListener('click', () => setPaused(!state.paused));
  $('#btn-seat').addEventListener('click', () => {
    const hero = table.players[HERO];
    hero.sittingOut = !hero.sittingOut;
    if (hero.sittingOut && state.heroResolve) heroAct(null);
    if (!hero.sittingOut && state.paused) setPaused(false);
    render();
  });
  // Two-step confirm in the page itself (some embeds block confirm()).
  let resetTimer = null;
  $('#btn-new').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (resetTimer) { clearTimeout(resetTimer); location.reload(); return; }
    b.textContent = 'Click again to reset';
    b.title = 'Stacks, stats and bot learning reset. Your saved mistakes are kept.';
    resetTimer = setTimeout(() => { resetTimer = null; b.textContent = 'New game'; }, 3000);
  });
  $('#speed').addEventListener('input', (e) => { state.speed = 1500 - Number(e.target.value); });
  state.speed = 1500 - Number($('#speed').value);
  $('#show-cards').addEventListener('change', (e) => { state.showCards = e.target.checked; renderTable(); });
  $('#learning').addEventListener('change', (e) => { state.learning = e.target.checked; });

  $('#act-fold').addEventListener('click', () => heroAct('fold'));
  $('#act-call').addEventListener('click', () => {
    const a = state.heroAnalysis;
    if (a) heroAct(a.view.toCall ? 'call' : 'check');
  });
  $('#act-raise').addEventListener('click', () => heroAct('raise', Number($('#raise-num').value)));
  $('#act-hint').addEventListener('click', () => {
    const a = state.heroAnalysis;
    if (!a) return;
    const h = $('#hint');
    h.hidden = false;
    h.textContent = Coach.hint(a);
  });
  $('#raise-amt').addEventListener('input', (e) => setRaise(Number(e.target.value)));
  $('#raise-num').addEventListener('change', (e) => setRaise(Number(e.target.value)));
  $$('.presets button').forEach((b) => b.addEventListener('click', () => {
    const a = state.heroAnalysis;
    if (!a) return;
    const v = a.view;
    const f = b.dataset.frac;
    if (f === 'min') return setRaise(v.minRaiseTo);
    if (f === 'max') return setRaise(v.maxRaiseTo);
    const frac = Number(f);
    setRaise(Math.round((v.currentBet + frac * (v.pot + v.toCall)) / 5) * 5);
  }));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="number"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const btn = $$('.actions button').find((b) => b.dataset.key === e.key.toUpperCase());
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => { p.hidden = p.id !== `tab-${t.dataset.tab}`; });
    if (t.dataset.tab === 'players') renderPlayers();
    if (t.dataset.tab === 'drills') renderDrills();
  }));
  $$('input[name="feed"]').forEach((r) => r.addEventListener('change', (e) => { state.feedFilter = e.target.value; renderFeed(); }));

  $('#tab-drills').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'drill-start' || t.id === 'drill-next') nextDrill();
    else if (t.dataset.drill && state.drill && !state.drill.answer) {
      const d = state.drill;
      d.answer = t.dataset.drill;
      d.spot.tries++;
      state.drillScore.tried++;
      if (d.answer === d.spot.bestType) { d.spot.right++; state.drillScore.right++; }
      saveMistakes();
    } else if (t.dataset.del) {
      state.mistakes = state.mistakes.filter((x) => x.id !== t.dataset.del);
      if (state.drill && state.drill.spot.id === t.dataset.del) state.drill = null;
      saveMistakes();
    }
    renderDrills();
  });

  render();
  loop();
})();
