# Poker Coach AI

A No-Limit Texas Hold'em training app: 7 AI players with distinct styles play each other, and 1 coach agent grades every decision using only what that player could see (their own cards plus public table info). Players adjust their play from the coach's lessons, and you can take a seat to be coached yourself.

## Run it
Open `app/index.html` in a browser. No install, no build, no server.

- **Deal** starts the AI table. **Take a seat** puts you in seat 0 (the bottom).
- On your turn: Fold / Check-Call / Bet-Raise (slider or ½, ⅔, pot, all-in presets). Keys: `F`, `C`, `R`, `H`.
- **Hint** shows the coach's pick, your equity and the pot odds before you act.
- After each decision you get a grade (Good / Okay / Mistake / Blunder), the cost in BB and a lesson.
- **Mistakes & drills** saves every Mistake or Blunder (in your browser) and replays them as quizzes until you get them right.
- **Players** shows stacks, mistake rates and how each bot's tendencies have shifted from the coach's lessons.

Tests: `node tests/run.js`

## How the coach works
Monte Carlo equity (800 runouts) against opponent ranges read from their public preflop actions, plus a one-street EV model: call EV from pot odds, and bet/raise EV from fold equity and equity when called. It is a teaching model, not a solver; it ignores future streets and implied odds.

## Plan (v1)
- Single-page web app (HTML/JS, no build step).
- Local poker engine: dealing, betting, side pots, showdown, hand evaluator.
- 7 player agents: Juno (novice), Mira (tight-aggressive), Dex (loose-aggressive), Otto (calling station), Rosa (rock), Kai (maniac), Theo (balanced).
- Coach agent: Monte Carlo equity + pot odds → grade (Good / Okay / Mistake / Blunder), chip loss in BB, plain-language lesson.
- Learning: lessons adjust each player's call margin, raise threshold, bluff rate and read error.
- Optional "Ask Claude" for deeper explanations, on demand only.
- Play-yourself seat with coach hints, mistake tracker and hand replay drills.

## Token policy
All math runs locally at zero token cost. Claude is called only when the user asks, with compact inputs and capped outputs. See `.claude/agents/token-optimizer.md`.
