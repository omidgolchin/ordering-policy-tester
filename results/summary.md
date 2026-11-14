# Ordering policy experiments

Engine: sim/chain.py (mirrored by docs/chain.js). Costs are one stage's holding + shortage costs over 36 weeks unless a whole-chain figure is named. Classic settings: order delay 1 week, shipping delay 2 weeks, holding $0.50 per unit-week, shortage $1.00 per unit-week, backlog cost model, 95% service-level targets, no information sharing.

## The classic game (demand 4, then 8 from week 5), you are the retailer

| Rule | Your cost | Whole chain | Your bullwhip | Factory bullwhip | Filled |
|---|---|---|---|---|---|
| Order-up-to | $188 | $1,374 | x4.6 | x120.2 | 65% |
| Order-up-to, smoothed (0.8) | $172 | $1,125 | x4.4 | x47.3 | 64% |
| Pass-through | $142 | $882 | x1.0 | x34.9 | 71% |

Recommendation: pass (warn). On a one-off, permanent step, pass-through wins at the retailer: it cannot amplify, and the target-based rules spend weeks chasing the new demand level with targets estimated from pre-step orders.

## Information sharing (all stages order-up-to)

- Factory bullwhip: x120.2 without sharing, x1.0 with sharing.
- Whole-chain cost: $1,374 without, $396 with.

## Four anchoring bots (Sterman 1989 parameters)

A chain of four simulated human players costs $2,464 as a chain, with bullwhips by stage of x4.0, x14.2, x38.5, x82.2. Sterman's classroom teams famously ran up about $2,000 of chain cost against a $0.50/$1.00 cost structure; the fitted heuristic lands in the same territory.

## Random demand (20 paths, mean 8, sd 3), shortage cost $2

| Rule | Your cost (median) | Middle 80% | Your bullwhip | Factory bullwhip | Filled |
|---|---|---|---|---|---|
| Order-up-to | $259 | $136-$416 | x2.0 | x313.0 | 79% |
| Order-up-to, smoothed (0.9) | $248 | $139-$438 | x1.6 | x226.1 | 78% |
| Pass-through | $308 | $151-$414 | x1.0 | x39.9 | 73% |

Under demand that keeps moving, the ranking flips: smoothing wins, because it stops the target-chasing that makes order-up-to expensive when every week brings a new surprise.

## Backlog vs lost sales (seasonal demand, you are the distributor)

Under backlogs the winner is pass-through ($368 against smoothing's $436): a backlog is patient, so a calm rule that lets orders wait looks cheap. Under lost sales the winner flips to smoothing ($302 against pass-through's $670): when the sale walks away, waiting is the expensive habit. On the classic step at the retailer the winner does not change (pass-through under both), which is why the tool reports the switch per setting instead of assuming it.

