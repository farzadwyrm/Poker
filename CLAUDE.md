# Project notes for Claude
- Keep the app dependency-free: plain HTML/CSS/JS in `app/`.
- Game math (equity, pot odds, grading) must stay in local code; never call an LLM for it.
- The coach may only read `coachView(seat)`: the acting player's hole cards plus public info. Never pass other players' cards to it.
- Before shipping any change that calls Claude, run the `token-optimizer` agent on it.
