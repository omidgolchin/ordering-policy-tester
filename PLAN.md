# Plan

Build P13v2 "Supply Chain Ordering Policy Tester" from the tools_v3
program spec, to the shared contract: a static page in `docs/` on the
shared kit, a JS engine mirrored by a Python reference, tests first
where the spec names them, no model calls, no GitHub push.

1. Study the contract, the product rules and the P13v2 spec; clone the
   reference tools (experiment-hazard-simulator, queue-simulator,
   bayesian-ab-lab) at current main and copy the shared kit files
   unchanged.
2. Build the simulation engine in Python (`sim/chain.py`): four-stage
   chain, weekly turn rhythm, the three rules plus Sterman's heuristic
   and scripted orders, backlog and lost-sales cost models, information
   sharing on/off, target from lead-time demand plus safety stock.
3. Verify the engine against the classic results (pass-through
   bullwhip 1, zero-lead-time zero backlog, Sterman chain cost in the
   classroom range) before mirroring it.
4. Mirror the engine in JS (`docs/chain.js`) arithmetic-for-arithmetic;
   prove agreement on three fixed games plus a full comparison.
5. Write the tests the spec names (textbook cases, verdict states,
   JS agreement, assist plumbing).
6. Build the page: Compare mode (inputs, verdict with checks, orders
   chart, numbers, smoothing curves, method notes) and Play mode
   (36-week game against chosen bots, end-screen benchmark), seven
   examples, AI assist with a 20-item test set.
7. Run the analysis (`sim/analyze.py`) for the README research notes.
8. Verify end to end: fresh-venv pytest, node syntax checks, the page
   in headless Chromium at desktop and phone widths — no console
   errors, every example, a full game by scripted clicks.
9. Write the release paperwork (README, DECISIONS, RELEASE_CHECK,
   REPORT_FOR_REVIEW) and commit locally. Publishing is a separate,
   approved step.
