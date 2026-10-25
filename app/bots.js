// Seven AI players with distinct styles. They decide from the coach's analysis of
// their own coachView (with a personal read error) and adjust from the coach's grades.
(function (root) {
  'use strict';

  const STYLES = [
    { name: 'Juno', style: 'Novice', blurb: 'Plays too many hands and misreads spots.', params: { callMargin: 0.1, raiseThreshold: 1.9, bluffRate: 0.05, readError: 0.15, sizeMult: 1 } },
    { name: 'Mira', style: 'Tight-aggressive', blurb: 'Picks strong hands and bets them hard.', params: { callMargin: -0.02, raiseThreshold: 1.4, bluffRate: 0.08, readError: 0.05, sizeMult: 1 } },
    { name: 'Dex', style: 'Loose-aggressive', blurb: 'Wide range, lots of pressure.', params: { callMargin: 0.04, raiseThreshold: 1.15, bluffRate: 0.2, readError: 0.07, sizeMult: 1.1 } },
    { name: 'Otto', style: 'Calling station', blurb: 'Calls almost anything, rarely raises.', params: { callMargin: 0.25, raiseThreshold: 2.2, bluffRate: 0.02, readError: 0.1, sizeMult: 1 } },
    { name: 'Rosa', style: 'Rock', blurb: 'Waits for premiums, folds the rest.', params: { callMargin: -0.08, raiseThreshold: 1.8, bluffRate: 0.01, readError: 0.05, sizeMult: 0.9 } },
    { name: 'Kai', style: 'Maniac', blurb: 'Raises and bluffs relentlessly.', params: { callMargin: 0.12, raiseThreshold: 0.9, bluffRate: 0.35, readError: 0.12, sizeMult: 1.5 } },
    { name: 'Theo', style: 'Balanced', blurb: 'Solid, close to the coach’s model.', params: { callMargin: 0, raiseThreshold: 1.35, bluffRate: 0.1, readError: 0.04, sizeMult: 1 } },
  ];

  const BOUNDS = { callMargin: [-0.1, 0.3], raiseThreshold: [0.8, 2.5], bluffRate: [0, 0.4], readError: [0.01, 0.2] };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function gauss(rng) {
    const u = 1 - rng(), w = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  function decide(analysis, params, rng = Math.random) {
    const v = analysis.view;
    const perceived = clamp(analysis.equity + gauss(rng) * params.readError, 0, 1);
    const rel = perceived * (analysis.nEff + 1); // 1.0 = fair share of the pot
    const raises = v.actions.filter((a) => a.street === v.street && a.type === 'raise').length;
    if (v.canRaise && analysis.raiseTo) {
      const sized = clamp(Math.round((analysis.raiseTo * params.sizeMult) / 5) * 5, v.minRaiseTo, v.maxRaiseTo);
      if (rel >= params.raiseThreshold * (1 + 0.5 * raises)) return { type: 'raise', amount: sized, reason: 'value' };
      if (raises < 2 && rng() < params.bluffRate) return { type: 'raise', amount: sized, reason: 'bluff' };
    }
    if (v.toCall === 0) return { type: 'check' };
    if (perceived + params.callMargin >= analysis.potOdds) return { type: 'call' };
    return { type: 'fold' };
  }

  // Nudge a bot's tendencies toward the coach's pick after a Mistake or Blunder.
  function learn(bot, g) {
    const p = bot.params;
    if (g.grade !== 'Mistake' && g.grade !== 'Blunder') {
      p.readError = clamp(p.readError * 0.9995, ...BOUNDS.readError);
      return null;
    }
    const k = (g.grade === 'Blunder' ? 2 : 1) * 0.3; // slow, so styles fade over many hands
    const notes = [];
    const adjust = (key, delta, note) => {
      p[key] = clamp(p[key] + delta, ...BOUNDS[key]);
      notes.push(note);
    };
    const c = g.chosen.type, b = g.best.type;
    if (c === 'call' && b === 'fold') adjust('callMargin', -0.01 * k, 'calls tighter');
    else if (c === 'fold' && b !== 'fold') adjust('callMargin', 0.01 * k, 'defends wider');
    if (c === 'raise' && b !== 'raise') {
      if (g.chosen.reason === 'bluff') adjust('bluffRate', -p.bluffRate * 0.1 * k, 'bluffs less');
      else adjust('raiseThreshold', 0.03 * k, 'raises only stronger hands');
    }
    if (b === 'raise' && c !== 'raise') adjust('raiseThreshold', -0.03 * k, 'raises more for value');
    p.readError = clamp(p.readError * 0.997, ...BOUNDS.readError);
    return notes.length ? `${bot.name} ${notes.join(', ')}` : null;
  }

  const api = { STYLES, decide, learn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerBots = api;
})(this);
