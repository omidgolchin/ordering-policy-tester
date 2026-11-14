"""Numbers behind the README's Research notes.

Runs the Python engine on the classic Beer Game settings and a few
variations, and writes results/summary.md. Everything here is an
experiment about the tool, so it lives outside the tool (product rule:
no experiments inside the tool).

Run: python -m sim.analyze
"""

import math
import random
from pathlib import Path

from sim.chain import create_game, evaluate_series, simulate, step_week

CLASSIC = dict(orderDelay=1, shipDelay=2, holdingCost=0.5, backlogCost=1.0,
               costModel="backlog", infoSharing=False, serviceLevel=0.95)
STEP = [4] * 4 + [8] * 32
OUT = {"type": "out", "alpha": 1.0}
PASS = {"type": "passthrough"}
STERMAN = {"type": "sterman"}
NAMES = {"out": "Order-up-to", "smooth": "Order-up-to, smoothed", "pass": "Pass-through"}


def _money(x):
    return f"${x:,.0f}"


def _bw(x):
    return "n/a" if x is None else f"x{x:.1f}"


def _rule_table(ev, lines, spread=False):
    head = "| Rule | Your cost | " + ("Middle 80% | " if spread else "") + "Whole chain | Your bullwhip | Factory bullwhip | Filled |"
    lines.append(head)
    lines.append("|" + "---|" * (7 if spread else 6))
    for key in ("out", "smooth", "pass"):
        r = ev["rules"][key]
        label = NAMES[key] + (f" ({r['alpha']:.1f})" if key == "smooth" else "")
        mid = f"{_money(r['yourCostLo'])}-{_money(r['yourCostHi'])} | " if spread else ""
        lines.append(f"| {label} | {_money(r['yourCost'])} | {mid}{_money(r['chainCost'])} | "
                     f"{_bw(r['yourBullwhip'])} | {_bw(r['factoryBullwhip'])} | {r['fillRate']:.0%} |")
    lines.append("")


def _old_opening(demand, cfg):
    """Sterman's opening: 12 units on hand and a flow of 4, whatever the
    rules' own steady state is."""
    state = create_game(cfg, demand, [OUT] * 4)
    state["inv"] = [12] * 4
    while state["t"] < state["weeks"]:
        step_week(state)
    zero_weeks = 0
    for q in state["orders"][3]:
        if q:
            break
        zero_weeks += 1
    return sum(state["cost"]), zero_weeks


def main():
    lines = ["# Ordering policy experiments", ""]
    lines.append("Engine: sim/chain.py (mirrored by docs/chain.js). Costs are one "
                 "stage's holding + shortage costs over 36 weeks unless a whole-chain "
                 "figure is named. Classic settings: order delay 1 week, shipping "
                 "delay 2 weeks, holding $0.50 per unit-week, shortage $1.00 per "
                 "unit-week, backlog cost model, 95% service-level targets, forecasts "
                 "from the last 8 weeks, no information sharing.")
    lines.append("")

    # 1. the opening
    steady_cfg = dict(CLASSIC, infoSharing=False)
    flat = [4] * 36
    new = simulate(steady_cfg, flat, [OUT] * 4)
    old_cost, old_zero = _old_opening(flat, steady_cfg)
    lines.append("## Why the chain opens in steady state, not with Sterman's 12 units")
    lines.append("")
    lines.append(f"With demand fixed at 4 a week and every stage ordering up to its target, "
                 f"Sterman's opening (12 units on hand) makes the factory order nothing for "
                 f"its first {old_zero} weeks and runs up {_money(old_cost)} of chain cost on "
                 f"demand that never moves: an order-up-to target with no demand spread wants "
                 f"no stock on hand, so every stage first sheds 12 units and the shedding "
                 f"travels upstream as a bullwhip. Opened at the rules' own steady state "
                 f"the same chain costs {_money(new['chainCost'])}. The earlier version of this "
                 f"tool used Sterman's opening and reported a factory bullwhip of x120 on the "
                 f"classic game; most of that was the opening, not the rules.")
    lines.append("")

    # 2. the classic game
    ev = evaluate_series(CLASSIC, [STEP], 0)
    rec = ev["recommendation"]
    lines.append("## The classic game (demand 4, then 8 from week 5), you are the retailer")
    lines.append("")
    _rule_table(ev, lines)
    p = ev["rules"]["pass"]
    lines.append(f"Recommendation: {NAMES[rec['rule']].lower()} ({rec['cls']}). Pass-through "
                 f"never rebuilds stock after a lasting jump: it orders what it sells, so the "
                 f"shortfall of the transition is never made up and it fills only "
                 f"{p['fillRate']:.0%} of orders. Order-up-to costs less but chases the new "
                 f"level through its 8-week forecast and fills {ev['rules'][rec['rule']]['fillRate']:.0%}; "
                 f"no smoothing factor beats it on a step.")
    lines.append("")

    on = simulate(dict(CLASSIC, infoSharing=True), STEP, [OUT] * 4)
    off = simulate(CLASSIC, STEP, [OUT] * 4)
    lines.append("## Information sharing (all stages order-up-to, classic game)")
    lines.append("")
    lines.append(f"- Bullwhip by stage without sharing: "
                 + ", ".join(_bw(s["bullwhip"]) for s in off["stages"])
                 + "; with sharing: " + ", ".join(_bw(s["bullwhip"]) for s in on["stages"]) + ".")
    lines.append(f"- Whole-chain cost: {_money(off['chainCost'])} without, {_money(on['chainCost'])} with.")
    lines.append("")

    # 3. forecast window against Chen et al.'s closed form
    lines.append("## Forecast window against Chen, Drezner, Ryan and Simchi-Levi (2000)")
    lines.append("")
    lines.append("For independent demand, an order-up-to retailer with a p-week moving-average "
                 "forecast and lead time L orders q = D + (L/p)(D - D[t-p]), so its bullwhip "
                 "ratio is exactly 1 + 2L/p + 2L^2/p^2. Simulated over 3,000 weeks of demand "
                 "with mean 50 and spread 5 (L = 3):")
    lines.append("")
    lines.append("| Window p | Simulated | Closed form | Factory (all four stages) |")
    lines.append("|---|---|---|---|")
    rng = random.Random(11)
    for p_w in (4, 8, 16):
        d = [max(0, round(rng.gauss(50, 5))) for _ in range(3000)]
        r = simulate(dict(CLASSIC, forecastWeeks=p_w), d, [OUT] * 4)
        th = 1 + 2 * 3 / p_w + 2 * 9 / p_w ** 2
        lines.append(f"| {p_w} | x{r['stages'][0]['bullwhip']:.2f} | x{th:.2f} | {_bw(r['stages'][3]['bullwhip'])} |")
    lines.append("")
    lines.append("The engine reproduces the formula (rounding to whole units adds a little), and "
                 "the factory column shows why the window is a decision: each stage multiplies "
                 "the amplification of the one below it.")
    lines.append("")

    # 4. human-like players
    ster = simulate(CLASSIC, STEP, [STERMAN] * 4)
    lines.append("## Four anchoring bots (Sterman 1989 parameters), classic game")
    lines.append("")
    bws = ", ".join(_bw(ster["stages"][i]["bullwhip"]) for i in range(4))
    lines.append(f"A chain of four simulated human players costs {_money(ster['chainCost'])} "
                 f"as a chain, with bullwhips by stage of {bws}, against {_money(off['chainCost'])} "
                 f"for four order-up-to stages. The fitted heuristic underweights the supply line "
                 f"(0.34), so it keeps ordering for goods already on the way.")
    lines.append("")

    # 5. random demand
    rng = random.Random(7)
    series = [[max(0, round(rng.gauss(8, 3))) for _ in range(36)] for _ in range(20)]
    ev2 = evaluate_series(CLASSIC, series, 0)
    lines.append("## Random demand around a steady mean (20 paths, mean 8, spread 3), retailer")
    lines.append("")
    _rule_table(ev2, lines, spread=True)
    rec2 = ev2["recommendation"]
    lines.append(f"Recommendation: {NAMES[rec2['rule']].lower()} ({rec2['cls']}). Passing orders on "
                 "keeps the stock position where it opened, which makes it an order-up-to rule "
                 "with its target frozen: the textbook best when the mean holds still, because "
                 "re-estimating the target only adds noise. The step above is where it fails.")
    lines.append("")

    # 6. backlog vs lost sales
    seasonal = [max(0, round(8 + 4 * math.sin(2 * math.pi * t / 12))) for t in range(36)]
    lines.append("## Backlog vs lost sales (seasonal demand)")
    lines.append("")
    lines.append("| Your stage | Best under backlogs | Best under lost sales |")
    lines.append("|---|---|---|")
    stages = ["Retailer", "Wholesaler", "Distributor", "Factory"]
    flips = 0
    for st in range(4):
        b = evaluate_series(CLASSIC, [seasonal], st)
        lo = evaluate_series(dict(CLASSIC, costModel="lost"), [seasonal], st)
        kb, kl = b["recommendation"]["rule"], lo["recommendation"]["rule"]
        flips += kb != kl
        lines.append(f"| {stages[st]} | {NAMES[kb]} ({_money(b['rules'][kb]['yourCost'])}) | "
                     f"{NAMES[kl]} ({_money(lo['rules'][kl]['yourCost'])}) |")
    lines.append("")
    lines.append(f"The best rule changes at {flips} of 4 stages when a stock-out loses the sale "
                 "instead of waiting, which is why the tool reports the switch per setting "
                 "instead of assuming it.")
    lines.append("")

    text = "\n".join(lines)
    out = Path(__file__).resolve().parents[1] / "results" / "summary.md"
    out.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
