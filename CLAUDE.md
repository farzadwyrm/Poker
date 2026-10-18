# Project notes for Claude
- Keep the app dependency-free: plain HTML/CSS/JS in `app/`.
- Game math (equity, pot odds, grading) must stay in local code; never call an LLM for it.
- The coach may only read `coachView(seat)`: the acting player's hole cards plus public info. Never pass other players' cards to it.
- Before shipping any change that calls Claude, run the `token-optimizer` agent on it.
- After any change to strategy, coach or equity code, run `node tests/coach_audit.js 600` (or the `coach-qa` agent). Targets: flip rate 0%, facing-a-bet calibration gap under 2 points, no real two pair+ folded to small bets beyond rare cases.
