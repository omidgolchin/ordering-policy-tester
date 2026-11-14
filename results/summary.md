# Ordering policy experiments

Engine: sim/chain.py (mirrored by docs/chain.js). Costs are one stage's holding + shortage costs over 36 weeks unless a whole-chain figure is named. Classic settings: order delay 1 week, shipping delay 2 weeks, holding $0.50 per unit-week, shortage $1.00 per unit-week, backlog cost model, 95% service-level targets, forecasts from the last 8 weeks, no information sharing.

## Why the chain opens in steady state, not with Sterman's 12 units

With demand fixed at 4 a week and every stage ordering up to its target, Sterman's opening (12 units on hand) makes the factory order nothing for its first 14 weeks and runs up $448 of chain cost on demand that never moves: an order-up-to target with no demand spread wants no stock on hand, so every stage first sheds 12 units and the shedding travels upstream as a bullwhip. Opened at the rules' own steady state the same chain costs $0. The earlier version of this tool used Sterman's opening and reported a factory bullwhip of x120 on the classic game; most of that was the opening, not the rules.

## The classic game (demand 4, then 8 from week 5), you are the retailer

| Rule | Your cost | Whole chain | Your bullwhip | Factory bullwhip | Filled |
|---|---|---|---|---|---|
| Order-up-to | $234 | $834 | x1.5 | x15.4 | 59% |
| Order-up-to, smoothed (1.0) | $234 | $834 | x1.5 | x15.4 | 59% |
| Pass-through | $369 | $800 | x1.0 | x6.5 | 42% |

Recommendation: order-up-to (warn). Pass-through never rebuilds stock after a lasting jump: it orders what it sells, so the shortfall of the transition is never made up and it fills only 42% of orders. Order-up-to costs less but chases the new level through its 8-week forecast and fills 59%; no smoothing factor beats it on a step.

## Information sharing (all stages order-up-to, classic game)

- Bullwhip by stage without sharing: x1.5, x3.3, x7.9, x15.4; with sharing: x1.5, x2.3, x3.2, x4.0.
- Whole-chain cost: $834 without, $685 with.

## Forecast window against Chen, Drezner, Ryan and Simchi-Levi (2000)

For independent demand, an order-up-to retailer with a p-week moving-average forecast and lead time L orders q = D + (L/p)(D - D[t-p]), so its bullwhip ratio is exactly 1 + 2L/p + 2L^2/p^2. Simulated over 3,000 weeks of demand with mean 50 and spread 5 (L = 3):

| Window p | Simulated | Closed form | Factory (all four stages) |
|---|---|---|---|
| 4 | x3.63 | x3.62 | x137.4 |
| 8 | x2.03 | x2.03 | x22.1 |
| 16 | x1.44 | x1.45 | x4.8 |

The engine reproduces the formula (rounding to whole units adds a little), and the factory column shows why the window is a decision: each stage multiplies the amplification of the one below it.

## Four anchoring bots (Sterman 1989 parameters), classic game

A chain of four simulated human players costs $1,766 as a chain, with bullwhips by stage of x1.7, x8.9, x33.6, x63.8, against $834 for four order-up-to stages. The fitted heuristic underweights the supply line (0.34), so it keeps ordering for goods already on the way.

## Random demand around a steady mean (20 paths, mean 8, spread 3), retailer

| Rule | Your cost | Middle 80% | Whole chain | Your bullwhip | Factory bullwhip | Filled |
|---|---|---|---|---|---|---|
| Order-up-to | $156 | $116-$211 | $1,107 | x2.4 | x17.5 | 94% |
| Order-up-to, smoothed (0.7) | $150 | $117-$212 | $1,039 | x1.4 | x12.1 | 93% |
| Pass-through | $138 | $94-$214 | $748 | x1.0 | x7.3 | 99% |

Recommendation: pass-through (good). Passing orders on keeps the stock position where it opened, which makes it an order-up-to rule with its target frozen: the textbook best when the mean holds still, because re-estimating the target only adds noise. The step above is where it fails.

## Backlog vs lost sales (seasonal demand)

| Your stage | Best under backlogs | Best under lost sales |
|---|---|---|
| Retailer | Order-up-to, smoothed ($172) | Order-up-to, smoothed ($168) |
| Wholesaler | Pass-through ($219) | Order-up-to, smoothed ($178) |
| Distributor | Pass-through ($378) | Pass-through ($205) |
| Factory | Pass-through ($350) | Order-up-to, smoothed ($275) |

The best rule changes at 2 of 4 stages when a stock-out loses the sale instead of waiting, which is why the tool reports the switch per setting instead of assuming it.

