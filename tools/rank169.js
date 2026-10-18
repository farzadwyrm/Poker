// Builds the 169 starting-hand ordering used by app/engine.js (PREFLOP_ORDER).
// Score = heads-up equity vs a random hand + small playability bonuses (suited, connected).
// Run: node tools/rank169.js
const P = require('../app/engine.js');
const R = P.RANKS, out = [];
for (let a = 12; a >= 0; a--) for (let b = a; b >= 0; b--) {
  const kinds = a === b ? [''] : ['s', 'o'];
  for (const k of kinds) {
    const c1 = a * 4, c2 = b * 4 + (k === 's' ? 0 : 1);
    let eq = P.equity([c1, c2], [], 1, 12000);
    if (k === 's') eq += 0.025;
    if (a !== b) { const gap = a - b - 1; if (gap === 0) eq += 0.012; else if (gap === 1) eq += 0.006; }
    else eq += 0.035;
    out.push([R[a] + R[b] + k, eq]);
  }
}
out.sort((x, y) => y[1] - x[1]);
console.log(out.map(x => x[0]).join(' '));
