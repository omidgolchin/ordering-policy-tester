# Ordering Policy Tester

For anyone who orders stock for one stage of a supply chain: play the ordering game yourself and feel why the bullwhip effect happens. Then find which reorder rule to use for your stage (order-up-to, order-up-to with smoothing, or passing orders straight on), scored on what it costs your stage and how hard it whips the chain upstream.

![The tester in three frames: the ordering game in play, the game's end screen, and the three rules ranked in Compare](docs/hero.gif)

![The tester on a desktop: the ordering game, the landing view, with the bullwhip effect explained beside it](docs/screenshots/desktop.png)

**Use it:** https://omidgolchin.github.io/ordering-policy-tester/ (runs in your browser; nothing you type leaves it)

## What it does

- **Play the game.** Take one role for 36 weeks against bot teammates you choose: order-up-to bots, a pass-through bot, or the anchoring bot that orders the way Sterman's real players did. Each week you see what arrived and what was ordered from you, then place your order. The end screen sets your cost and bullwhip ratio next to the best rule's on the same demand.
- **Compare rules.** Set your stage (retailer, wholesaler, distributor or factory), order and shipping delays, holding and shortage costs, what an unfilled order becomes (a backlog or a lost sale), the service level or "balanced to my costs", the forecast window, and a demand pattern: a step, steady, seasonal, random around a steady mean, or your own pasted series. The tool simulates a four-stage chain for 36 weeks and recommends a rule with its parameters: "Use order-up-to with smoothing 0.6 and a target of 32 units." You get your cost (with its range over 20 demand paths when demand is random), your bullwhip ratio (variance of your orders over variance of demand), the factory's, your fill rate, and the three rules ranked in a table with cost and bullwhip columns.
- **Fill from my description (AI).** Describe your setup in your own words; a model (your key, or copy the prompt into any assistant) fills in the settings it can find, quotes your words for each one, and lists what you did not state. You confirm before anything is applied.
- **Start here.** The page opens with the question it answers and three steps; a menu of common situations fills Compare; and a section says when to use the tool and when not.
- **Help where you need it.** Every input has a line under it saying what the number is, why it matters and where to find it; every technical term in the inputs and results has a **?** that opens a plain-language explanation; and a short box beside the game explains the bullwhip effect in plain words.

## Built-in checks

| Check | What it shows |
|---|---|
| Order-up-to target | The target taken apart: lead-time demand plus safety stock, and the service level that safety stock buys. |
| Service level from your costs | Your costs' critical ratio, shortage ÷ (shortage + holding), and what the recommended rule would cost aimed at it instead of the level you picked. When the forecast lags demand, the higher level can win; the check prices it rather than assuming. |
| Information sharing | What happens to the factory's bullwhip if every stage plans against customer demand instead of the orders it receives (Lee, Padmanabhan and Whang, 1997), and when it barely helps. |
| Forecast window | The factory's bullwhip at half and twice your forecast window. Short windows chase noise and every stage multiplies it (Chen, Drezner, Ryan and Simchi-Levi, 2000); on most settings the window moves the factory as much as the rule does. |
| Why passing orders on can win | When passing orders on is cheapest: it is order-up-to with the target frozen, right when the mean holds still and wrong after a lasting change. |
| Backlog or lost sales? | Whether the best rule changes if unfilled orders are lost sales instead of backlogs. It does at half the stages on seasonal demand. |
| The smoothing trade-off | Your cost and bullwhip across smoothing factors 0.2 to 1.0 (Disney and Towill, 2003), and a plain statement when no smoothing pays. |

## Design decisions

- **One stage is yours; the rest of the chain is fixed.** Only your stage's rule changes between comparisons, and the other stages use plain order-up-to. That isolates what your rule does, which is the decision you actually control.
- **The chain opens in steady state.** Pipelines start full at the opening demand level and every stage holds its safety stock, so demand that never moves costs nothing under any rule (tested). Sterman's 12-unit opening is the classroom game's, not the rules' steady state: under it an order-up-to stage opens by shedding 12 units, the factory orders nothing for 14 weeks on flat demand, and the "bullwhip" measured is mostly the opening. An earlier version of this tool made that mistake and reported a factory bullwhip of ×120 on the classic game; it is ×15 now. `DECISIONS.md` records the change.
- **Targets from the textbook formula, with the forecast as the moving part.** S = forecast × lead time + z × demand spread × √lead time (Silver, Pyke and Thomas, 2016). The safety stock is set once from the demand's spread; the forecast is a moving average of the last p weeks of the orders a stage receives, or of customer demand when demand is shared. Forecasting from orders is the mechanism behind the bullwhip (Lee, Padmanabhan and Whang, 1997).
- **Smoothing is proportional order-up-to.** Order the forecast plus a fraction of the remaining gap (Disney and Towill, 2003), so steady demand is met exactly and factor 1.0 is plain order-up-to. Scaling the whole order by the factor, the tempting shortcut, under-orders every week until a backlog builds; this tool did that once, and a test now holds smoothing steady on flat demand.
- **Lead times are effective lead times.** A shipment lands the week after it is made at the earliest, and the factory produces rather than orders, so its lead time has no order delay.
- **Random demand is a distribution, not a path.** Verdicts use the median of 20 demand paths and show the middle 80% range, so a lucky path cannot crown a rule. Near ties (within 2%) go to the calmer orders.
- **The AI assist only reads.** It extracts settings from your description with a quote for each value; every number in the verdict comes from the simulator.

## Validation

- **22 tests** (`pytest`): the normal CDF and quantile; the target formula by hand; flat demand keeping every rule at zero cost and constant stock across five lead-time settings, with and without sharing; the retailer's bullwhip against Chen et al.'s closed form 1 + 2L/p + 2L²/p² over 3,000 weeks (within 3% at p = 4, 8, 16); the moving-average forecast on a constructed history; pass-through's bullwhip exactly 1 at the retailer; smoothing factor 1 reproducing order-up-to order for order, and the proportional rule on a constructed state; the Sterman bot against the published rule; lost sales cancelling instead of backlogging; information sharing cutting the factory's bullwhip; every verdict state (good, tie, warn) reached by a constructed case; the JavaScript engine against the Python reference (`sim/chain.py`) on three fixed games and a full comparison; the AI assist's prompt, reply parsing and quote checks.
- **AI extraction: not yet run.** The 20-item test set (`assist/testset.json`) is scored with `node scripts/eval_assist.js` once a key for a current model is available (the tool budget is $0); the harness and the set ship with the tool.
- Checked on desktop (1366px) and phone (390px) widths with no console errors and no sideways scrolling; every example loads, and a full 36-week game completes by scripted clicks.

## What I learned

- The opening state is a modelling decision that can fake a result. Sterman's 12 units are a fine classroom start and a wrong steady state for an order-up-to rule; the bullwhip I first measured was the chain shedding that stock. A flat-demand test that must cost exactly zero is now the first thing I check in any simulation like this.
- The forecast window is as big a lever as the rule. On the classic game the factory's bullwhip is ×65 with a 4-week window, ×15 with 8 and ×8 with 16, while switching rules moves it by a factor of about two.
- Pass-through is not naive; it is order-up-to with its target frozen. That makes it the cheapest rule on noisy demand around a steady mean and the most expensive after a lasting jump, where it never rebuilds the stock the transition took.
- Fill rates are the honest shock. After demand doubles, even the best rule fills about six orders in ten over the game, because the forecast takes weeks to catch up and the whole chain catches up at once.

## Common situations

The form opens with "Start from a common situation". Each entry fills the form and says what it shows:

| Situation | What it shows |
|---|---|
| The classic: demand steps up | The Beer Game's demand doubles in week 5. Watch the factory, and what sharing demand does to it. |
| Steady demand, same every week | The baseline: nothing changes, so nothing goes wrong. |
| Noisy demand, pricey stock-outs | The rules land close; the forecast window moves the factory more than the rule does. |
| Long lead time, pricey stock-outs | The step hurts for longer, and sharing demand calms the factory about tenfold. |
| Unfilled orders are lost sales | Seasonal demand; smoothing edges out pass-through, which would win under backlogs. |
| Cheap storage, costly shortages | Aim high and smooth lightly. |
| Your own demand, pasted in | The rules are scored on exactly your path. |

To add a situation, append an entry `{name, note, set}` to `EXAMPLES` in `docs/app.js`.

## When to use it, and when not

Use it to choose and tune a periodic reorder rule for one stage of a chain that orders from the stage above it every week: a store ordering from a distributor, a distributor from a manufacturer, or to show a team why order swings grow up the chain.

| It assumes | If yours differs |
|---|---|
| A serial chain of four stages and one product; each stage orders from the one above, and the factory produces. | With several suppliers or customers per stage, the bullwhip still builds but the numbers will differ. Use the tool for the main supply route only. |
| The other three stages follow plain order-up-to. | Real partners may anchor or panic like Sterman's players; the Play mode's anchoring bot shows how much worse that gets. The Compare costs are then optimistic. |
| Order and shipping delays are fixed and known. | Delays that vary need extra safety stock the formula does not add. Use your longer, typical delay as a first cut. |
| Costs are per unit per week (holding and shortage); no fixed cost per order. | With a large cost per order, you will want to order in batches: an (s, S) or economic-order-quantity rule fits better. |
| The factory has unlimited capacity, and stock does not spoil. | If the factory is capacity-bound, its queue adds delay the tool ignores; for perishable stock, see the Order Quantity Planner. |
| Each stage forecasts with a moving average of the orders it receives (or of customer demand when demand is shared). | Exponential smoothing or a planner's judgment changes the bullwhip; the forecast-window check shows how sensitive the answer is. |
| The comparison runs 36 weeks on one of five demand patterns or your pasted series. | Rare events longer than 36 weeks are not tested. Paste a longer series to test your own path. |

Do not use it for one-off orders of seasonal or perishable goods (use the Order Quantity Planner), for multi-echelon networks with many locations (use a supply-chain planning system), or for production scheduling at a capacity-bound factory.

## Where it comes from, and how it was generalised

The tool comes out of the Beer Game, the four-stage ordering game from MIT in which demand steps up once and orders swing wildly up the chain (Sterman, 1989), and the research that explained it: forecasting from received orders drives the bullwhip (Lee, Padmanabhan and Whang, 1997), and its size grows with lead time and shrinks with a longer forecast window (Chen, Drezner, Ryan and Simchi-Levi, 2000).

Experiments on this repository's Python engine ([results/summary.md](https://github.com/omidgolchin/ordering-policy-tester/blob/main/results/summary.md)) shaped the tool. The classic game's opening stock, not the rules, caused most of the bullwhip first measured, so the chain now opens in steady state. Sharing customer demand cut the factory's bullwhip from ×15.4 to ×4.0. Four anchoring players ran up $1,766 of chain cost against $834 for four order-up-to stages. The forecast window moved the factory's bullwhip more than the choice of rule did (×65 with a 4-week window, ×15 with 8, ×8 with 16, against a factor of about two between rules).

**How it was generalised.** The game fixes one demand step, one cost pair and four human players. The tool keeps the game as the Play mode, and in Compare turns the game's fixed settings into your inputs (stage, delays, costs, backlog or lost sales, service level, forecast window, demand pattern or your own series), with three textbook rules scored on the same demand.

## Research notes

Experiments run with the Python engine live in [`results/summary.md`](results/summary.md) (regenerate with `python -m sim.analyze`): the opening-stock artifact (14 weeks of zero factory orders and $448 of chain cost on flat demand under Sterman's opening, $0 in steady state); the classic game's three rules; information sharing cutting the factory's bullwhip from ×15.4 to ×4.0 and chain cost from $834 to $685; the engine against Chen et al.'s closed form; four anchoring bots running up $1,766 of chain cost against $834 for four order-up-to stages; and the backlog-vs-lost-sales flip at two of four stages on seasonal demand.

## Run it

Open `docs/index.html` in a browser, or serve the folder:

```
python3 -m http.server --directory docs 8000
```

Tests need Python 3.12 and Node:

```
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest
```

## Layout

- `docs/` — the tool: `index.html`, `app.js`, the engine `chain.js`, the AI-assist config, and the shared tool kit (`kit.css`, `kit-theme.js`, `tool.css`, `tool-common.js`, unchanged across the tool family).
- `sim/` — the Python reference engine (`chain.py`), the JS agreement runner (`js_check.mjs`), and `analyze.py` for the research notes.
- `tests/` — engine, verdict-state, JS-agreement and assist tests.
- `assist/testset.json` — 20 descriptions with the settings a careful reader should extract.
- `scripts/eval_assist.js` — scores a model's extraction against the test set (needs an API key).
- `results/` — experiment summaries behind the Research notes.

## Limitations

- One product, one chain, no capacity limits, no ordering costs, no perishability. The factory has unlimited production capacity; real chains queue.
- Teammates in Compare mode always use plain order-up-to, and in Play mode the bots do not learn. The comparison answers "what should my rule be, given a conventional chain", not "what is the chain-wide optimum".
- The safety stock uses the spread of the whole demand pattern you chose, as a planner sizing it from history would; the forecast of the mean is what each stage learns week by week.
- Costs are linear and identical in structure at every stage; only your stage's cost is the verdict's headline.

## References

- Sterman, J. D. (1989). Modeling managerial behavior: Misperceptions of feedback in a dynamic decision making experiment. *Management Science*, 35(3), 321–339.
- Lee, H. L., Padmanabhan, V., & Whang, S. (1997). Information distortion in a supply chain: The bullwhip effect. *Management Science*, 43(4), 546–558.
- Chen, F., Drezner, Z., Ryan, J. K., & Simchi-Levi, D. (2000). Quantifying the bullwhip effect in a simple supply chain. *Management Science*, 46(3), 436–443.
- Disney, S. M., & Towill, D. R. (2003). On the bullwhip and inventory variance produced by an ordering policy. *Omega*, 31(3), 157–167.
- Silver, E. A., Pyke, D. F., & Thomas, D. J. (2016). *Inventory and Production Management in Supply Chains* (4th ed.). CRC Press.

## License

MIT — see `LICENSE`.
