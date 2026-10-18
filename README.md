# Poker Coach AI

A No-Limit Texas Hold'em training app: 7 AI players with distinct styles play each other, and 1 coach agent grades every decision using only what that player could see (their own cards plus public table info). Players adjust their play from the coach's lessons, and you can take a seat to be coached yourself.

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
