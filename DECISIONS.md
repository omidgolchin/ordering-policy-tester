# Decisions

Choices made while building the Ordering Policy Tester, and why. The
spec (tools_v3 P13v2) and the product contract win on anything not
listed here.

## Engine

- **Only your stage's rule varies.** In Compare mode the other three
  stages always use plain order-up-to; in Play mode your teammates are
  the bots you picked. The tool's one job is "which rule should *I*
  use", so the comparison isolates your rule instead of re-optimizing
  the whole chain behind your back.
- **The order is decided inside the stage's turn, after shipping.**
  A first version decided the order from last week's information and
  the chain starved (fill rates near 0.3 even with generous targets).
  In the weekly rhythm of the Beer Game a stage sees this week's
  incoming order, ships, then orders — so the policy reads the state at
  that point. Fill rates and costs became textbook-plausible after the
  change.
- **No-sharing demand estimates use an expanding window.** Each stage
  plans against the mean and spread of all incoming orders received so
  far. Trailing windows (6–16 weeks) were tried; they did not fix the
  post-step starvation (it is upstream-driven) and added a parameter
  nobody could explain. Expanding estimates are also what makes
  pass-through's calm and order-up-to's target-chasing legible.
- **Lead time in the target formula is max(order + shipping delay, 1).**
  With both delays at zero, goods ordered this week still land next
  week in the simulation's rhythm, so a target covering zero weeks
  would order nothing and stock out by construction.
- **Round-half-up everywhere, in both engines.** Quantities are whole
  units; JavaScript's Math.round and Python's round() disagree on
  halves, so both engines use floor(x + 0.5). The normal CDF is the
  same Abramowitz–Stegun polynomial in both, and the inverse is the
  same bisection, so JS and Python agree to float precision — the
  agreement test holds them to it.
- **Verdict "warn" fires when the best rule fills under 75%.** In this
  engine even good rules fill only ~70–80% right after a demand step;
  a 90% threshold would make warn meaningless (always on). 75% marks
  "more than a quarter of orders unfilled", which is a genuine service
  problem worth its own verdict state. Warn outranks the tie state:
  a tie between two rules that both stock out is a warning first.
- **Pass-through's textbook test is at the retailer.** Its orders equal
  its incoming orders at every stage by construction; the bullwhip
  ratio is exactly 1 where the incoming series is the demand itself.
  Upstream, a delayed copy of a step changes composition inside a fixed
  36-week window, so upstream ratios sit slightly above 1 on a step —
  a window artifact, verified by the orders series being identical.

## Product

- **The comparison the verdict quotes is against pass-through**, per
  the spec: the recommended rule's cost and factory bullwhip are always
  stated next to pass-through's, even when another rule is runner-up.
- **The page recomputes the flipped-sharing and flipped-cost-model
  numbers for the rule it actually recommends** (which depends on the
  rules the visitor ticked), instead of reusing the engine's full-set
  alternates. A few extra simulations keep the checks honest under
  every checkbox combination.
- **Random demand on the page uses fixed seeds** (20 paths), so the
  verdict a visitor sees is the verdict the tests saw, and copying the
  link reproduces it.
- **Play mode shows the order-up-to suggestion every week.** The game
  is the hook, but the lesson lands when your number is compared with
  a rule's number at the end; the suggestion keeps first-time players
  from drowning in week 3. Overriding it is the interesting move, and
  the snapshot/restore turn flow makes overrides exact.
- **URL state is skipped on file:// pages.** The shared kit's parameter
  helper cannot parse a file: URL; the app guards its calls so the
  tool also works opened as a local file (GitHub Pages, the real home,
  uses https and is unaffected).
- **Requirements are pytest only.** The engine is pure Python (no
  NumPy/SciPy), so the fresh-venv install stays small and honest.
