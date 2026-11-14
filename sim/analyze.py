"""Numbers behind the README's Research notes.

Runs the Python engine on the classic Beer Game settings and a few
variations, and writes results/summary.md. Everything here is an
experiment about the tool, so it lives outside the tool (product rule:
no experiments inside the tool).

Run: python -m sim.analyze
"""

import random
from pathlib import Path

from sim.chain import evaluate_series, simulate

CLASSIC = dict(orderDelay=1, shipDelay=2, holdingCost=0.5, backlogCost=1.0,
               costModel="backlog", infoSharing=False, serviceLevel=0.95)
STEP = [4] * 4 + [8] * 32
OUT = {"type": "out", "alpha": 1.0}
PASS = {"type": "passthrough"}
STERMAN = {"type": "sterman"}


def _money(x):
    return f"${x:,.0f}"


def _bw(x):
    return "n/a" if x is None else f"x{x:.1f}"


def main():
    lines = ["# Ordering policy experiments", ""]
    lines.append("Engine: sim/chain.py (mirrored by docs/chain.js). Costs are one "
                 "stage's holding + shortage costs over 36 weeks unless a whole-chain "
                 "figure is named. Classic settings: order delay 1 week, shipping "
                 "delay 2 weeks, holding $0.50 per unit-week, shortage $1.00 per "
                 "unit-week, backlog cost model, 95% service-level targets, no "
                 "information sharing.")
    lines.append("")

    ev = evaluate_series(CLASSIC, [STEP], 0)
    lines.append("## The classic game (demand 4, then 8 from week 5), you are the retailer")
    lines.append("")
    lines.append("| Rule | Your cost | Whole chain | Your bullwhip | Factory bullwhip | Filled |")
    lines.append("|---|---|---|---|---|---|")
    names = {"out": "Order-up-to", "smooth": "Order-up-to, smoothed", "pass": "Pass-through"}
    for key in ("out", "smooth", "pass"):
        r = ev["rules"][key]
        label = names[key] + (f" ({r['alpha']:.1f})" if key == "smooth" else "")
        lines.append(f"| {label} | {_money(r['yourCost'])} | {_money(r['chainCost'])} | "
                     f"{_bw(r['yourBullwhip'])} | {_bw(r['factoryBullwhip'])} | {r['fillRate']:.0%} |")
    lines.append("")
    lines.append(f"Recommendation: {ev['recommendation']['rule']} "
                 f"({ev['recommendation']['cls']}). On a one-off, permanent step, "
                 "pass-through wins at the retailer: it cannot amplify, and the "
                 "target-based rules spend weeks chasing the new demand level with "
                 "targets estimated from pre-step orders.")
    lines.append("")

    on = simulate(dict(CLASSIC, infoSharing=True), STEP, [OUT] * 4)
    off = simulate(CLASSIC, STEP, [OUT] * 4)
    lines.append("## Information sharing (all stages order-up-to)")
    lines.append("")
    lines.append(f"- Factory bullwhip: {_bw(off['stages'][3]['bullwhip'])} without sharing, "
                 f"{_bw(on['stages'][3]['bullwhip'])} with sharing.")
    lines.append(f"- Whole-chain cost: {_money(off['chainCost'])} without, {_money(on['chainCost'])} with.")
    lines.append("")

    ster = simulate(CLASSIC, STEP, [STERMAN] * 4)
    lines.append("## Four anchoring bots (Sterman 1989 parameters)")
    lines.append("")
    bws = ", ".join(_bw(ster["stages"][i]["bullwhip"]) for i in range(4))
    lines.append(f"A chain of four simulated human players costs {_money(ster['chainCost'])} "
                 f"as a chain, with bullwhips by stage of {bws}. Sterman's classroom "
                 "teams famously ran up about $2,000 of chain cost against a $0.50/$1.00 "
                 "cost structure; the fitted heuristic lands in the same territory.")
    lines.append("")

    rng = random.Random(7)
    series = [[max(0, round(rng.gauss(8, 3))) for _ in range(36)] for _ in range(20)]
    ev2 = evaluate_series(dict(CLASSIC, backlogCost=2.0), series, 0)
    lines.append("## Random demand (20 paths, mean 8, sd 3), shortage cost $2")
    lines.append("")
    lines.append("| Rule | Your cost (median) | Middle 80% | Your bullwhip | Factory bullwhip | Filled |")
    lines.append("|---|---|---|---|---|---|")
    for key in ("out", "smooth", "pass"):
        r = ev2["rules"][key]
        label = names[key] + (f" ({r['alpha']:.1f})" if key == "smooth" else "")
        lines.append(f"| {label} | {_money(r['yourCost'])} | {_money(r['yourCostLo'])}-{_money(r['yourCostHi'])} | "
                     f"{_bw(r['yourBullwhip'])} | {_bw(r['factoryBullwhip'])} | {r['fillRate']:.0%} |")
    lines.append("")
    lines.append("Under demand that keeps moving, the ranking flips: smoothing wins, "
                 "because it stops the target-chasing that makes order-up-to expensive "
                 "when every week brings a new surprise.")
    lines.append("")

    seasonal = [max(0, round(8 + 4 * __import__("math").sin(2 * __import__("math").pi * t / 12)))
                for t in range(36)]
    back_s = evaluate_series(CLASSIC, [seasonal], 2)
    lost_s = evaluate_series(dict(CLASSIC, costModel="lost"), [seasonal], 2)
    rb, rl = back_s["rules"], lost_s["rules"]
    lines.append("## Backlog vs lost sales (seasonal demand, you are the distributor)")
    lines.append("")
    lines.append(f"Under backlogs the winner is pass-through ({_money(rb['pass']['yourCost'])} "
                 f"against smoothing's {_money(rb['smooth']['yourCost'])}): a backlog is "
                 "patient, so a calm rule that lets orders wait looks cheap. Under lost "
                 f"sales the winner flips to smoothing ({_money(rl['smooth']['yourCost'])} "
                 f"against pass-through's {_money(rl['pass']['yourCost'])}): when the sale "
                 "walks away, waiting is the expensive habit. On the classic step at the "
                 "retailer the winner does not change (pass-through under both), which is "
                 "why the tool reports the switch per setting instead of assuming it.")
    lines.append("")

    text = "\n".join(lines)
    out = Path(__file__).resolve().parents[1] / "results" / "summary.md"
    out.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
