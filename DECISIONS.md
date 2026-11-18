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
  that point.
- **The chain opens in the rules' steady state (revised).** The first
  version opened like Sterman's game, 12 units on hand and a flow of 4.
  An order-up-to target with no demand spread wants no stock on hand,
  so every order-up-to stage opened by shedding 12 units: the factory
  ordered nothing for 14 weeks on flat demand, and the classic game's
  factory bullwhip read x120, mostly the opening. Now the opening flow
  is the median of the first four weeks of demand and every stage
  starts at its safety stock; a test holds flat demand at zero cost
  for every rule, lead time and sharing setting.
- **Safety stock is fixed at planning time; the forecast moves.** The
  target is forecast x L + z x sigma x sqrt(L), with sigma the spread
  of customer demand. Re-estimating sigma from a stage's own orders
  made targets swing with the bullwhip itself; a fixed safety-stock
  parameter is how inventory systems are run, and it keeps the
  mechanism the tool is about (forecasting from orders) isolated.
- **Forecasts are a moving average of the last p weeks, p visible.**
  The first version used all history, which reacts to a step for the
  rest of the game. A p-week moving average is the textbook setup of
  Chen, Drezner, Ryan and Simchi-Levi (2000), whose closed form
  1 + 2L/p + 2L^2/p^2 the engine reproduces (tested). p defaults to 8
  and is an input, because it moves the factory's bullwhip as much as
  the choice of rule does.
- **Smoothing is proportional order-up-to: forecast plus alpha x gap.**
  The first version ordered alpha x (target - position), which under-
  orders every week until a backlog builds to compensate; on flat
  demand at alpha 0.4 it ordered 2, then 4, then 5 against demand of 6.
  Disney and Towill's rule adds the forecast back, so it orders exactly
  demand in steady state and alpha 1 is still plain order-up-to.
- **Lead times are effective lead times.** A shipment lands the week
  after it is made at the earliest, so a stage's lead time is order
  delay + max(shipping delay, 1); the factory produces rather than
  orders, so its lead time is max(shipping delay, 1). The first version
  gave the factory the order delay too, so it held extra stock forever.
- **Smoothing at factor 1.0 is not a second rule, and near ties go to
  the calmer orders.** When the best smoothing factor is 1.0 the
  "smoothed" rule is order-up-to itself; it no longer creates a tie
  with it. Within 2% of the cheapest cost, the verdict picks the rule
  with the lower bullwhip at your stage, as its text always said.
- **Round-half-up everywhere, in both engines.** Quantities are whole
  units; JavaScript's Math.round and Python's round() disagree on
  halves, so both engines use floor(x + 0.5). The normal CDF is the
  same Abramowitz–Stegun polynomial in both, and the inverse is the
  same bisection, so JS and Python agree to float precision — the
  agreement test holds them to it.
- **Verdict "warn" fires when the best rule fills under 75%.** After a
  lasting demand step even the best rule fills only about 60% over the
  game; on noisy demand good rules fill above 90%. 75% marks
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
- **URL state is skipped on file:// pages.** The app writes the link
  only on http(s) pages, so the tool also works opened as a local file.
- **The service level can come from your costs.** "Balanced to my
  costs" uses the critical ratio shortage / (shortage + holding); with a
  fixed service level picked instead, a check prices the gap between
  the two. On a game with a demand step the higher level often wins,
  because the forecast lags; the check says so rather than assuming
  the textbook ratio is always right.
- **95% stays the default; "Balanced to my costs" is opt-in.** The
  page opens on the classic game, whose textbook setting is 95%, and
  the opening example and every headline figure are computed at it.
  Balanced sits first in the select and the hint recommends it once
  the costs are the visitor's own, but as the default it would set the
  target from the placeholder costs ($0.50 holding, $1.00 shortage,
  a 67% level) before a first-time visitor has typed anything, and it
  would move the classic-game numbers on the page, in the README
  and in results/. Verified end to end against the live
  page on 2026-11-18 (PM review item OP-D1): the option and the auto
  branch were already in the page from the kit rebuild; what was
  missing was a test, and tests/test_service_level.py now pins the
  option's presence in the select and the level the branch computes,
  so the checks cannot recommend an option that is not there.
- **Requirements are pytest only.** The engine is pure Python (no
  NumPy/SciPy), so the fresh-venv install stays small and honest.
