"""Supply chain ordering-policy engine (Python reference implementation).

Mirrors docs/chain.js exactly; tests/test_js_agreement.py checks the two
agree on fixed games. The JavaScript engine is what the page runs.

The chain has four stages: 0 retailer, 1 wholesaler, 2 distributor,
3 factory. Customer demand arrives at the retailer. Each week, stages act
in downstream-to-upstream order, and each stage's turn is:

  1. Goods arrivals land in inventory (shipments sent `ship_delay` weeks
     ago, or, for the factory, production finished `ship_delay` weeks
     after the factory ordered it). An arrival scheduled for the current
     week after this step has already run (only possible with a zero
     delay) is carried to the stage's next turn.
  2. The stage receives its incoming order: customer demand for the
     retailer, otherwise the order the downstream stage placed
     `order_delay` weeks ago. With `order_delay` 0, an order placed this
     week is seen by the upstream stage later in the same week.
  3. The stage ships min(inventory, owed). Owed is the new order plus any
     backlog. Under the backlog cost model the unfilled rest stays owed;
     under lost sales it is cancelled (and the downstream stage's supply
     line shrinks by the cancelled amount, since those units never come).
  4. Costs: holding cost on end-of-week inventory, plus backlog cost per
     unit-week of backlog (backlog model) or per unit lost (lost sales).
  5. The stage places its order (its policy decides). Orders reach the
     upstream stage after `order_delay` weeks; the factory's production
     orders complete after `ship_delay` weeks.

The chain opens in steady state. The opening flow F is the median of the
first four weeks of demand; every pipeline is full at F a week, and every
stage starts with its safety stock on hand, so a chain facing steady
demand stays exactly steady and any turbulence is the rules' doing.
(Sterman's game opens with 12 units on hand and a flow of 4, which is
12 units more than an order-up-to target with no demand spread wants:
those rules would open by ordering nothing, and the bullwhip measured
would be the opening's, not the rule's.)

Lead times are effective lead times. An order placed in week t reaches
the supplier after order_delay weeks; goods shipped arrive after
max(ship_delay, 1) weeks, since a shipment made in a week lands at the
earliest the next week. A stage's lead time is order_delay +
max(ship_delay, 1); the factory, which produces rather than orders, has
max(ship_delay, 1).

Inventory position = on-hand inventory + supply line - backlog, where the
supply line is everything the stage has ordered that is not yet in its
inventory (orders not yet received upstream, goods in transit, and, for
the factory, production in progress).

Policies (one per stage):
  passthrough  order exactly the incoming order.
  out          order-up-to: order mu + alpha * (S - inventory position - mu),
               rounded, never below 0, with mu the stage's demand
               estimate. alpha 1 is the plain rule (order S - position);
               smaller alpha is the proportional order-up-to (POUT) rule of
               Disney and Towill: the forecast plus only part of the gap,
               so in steady state it orders exactly demand. (Scaling the
               whole order by alpha instead would under-order every week
               until a backlog built up to compensate.) Disney and
               Towill. S is the computed target (below).
  sterman      Sterman's (1989) anchoring heuristic with his estimated
               parameters (theta 0.36, alpha 0.26, beta 0.34): expected
               demand anchors on the incoming order, and the order corrects
               a fraction of the gap between a desired stock S* and the
               inventory, discounted by the supply line.
  scripted     a fixed list of orders, by week (tests and benchmarks).

The order-up-to target is S = mu * L + z * sigma * sqrt(L), with L the
stage's lead time, z the service-level quantile and sigma the population
standard deviation of customer demand. The safety stock z * sigma *
sqrt(L) is set at planning time and held fixed, as an inventory system's
safety-stock parameter is. mu is the mean demand the stage plans
against: with information sharing, customer demand; without it, the
running mean of the stage's own incoming orders, which is all it can
see (the demand-signal processing of Lee, Padmanabhan and Whang, 1997).
"""

import math

STAGES = 4
OPEN_WEEKS = 4  # the opening flow is the median of this many first weeks
FORECAST_WEEKS = 8  # default moving-average window for the demand forecast

STERMAN_THETA = 0.36
STERMAN_ALPHA = 0.26
STERMAN_BETA = 0.34


def round_half_up(x):
    return math.floor(x + 0.5)


def norm_cdf(x):
    """Abramowitz and Stegun 7.1.26; identical formula in chain.js."""
    t = 1.0 / (1.0 + 0.2316419 * abs(x))
    poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    tail = math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi) * poly
    return 1.0 - tail if x >= 0 else tail


def norm_inv(p):
    """Inverse of norm_cdf by bisection; identical procedure in chain.js."""
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2.0
        if norm_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def pvariance(xs):
    if not xs:
        return 0.0
    m = mean(xs)
    return sum((x - m) ** 2 for x in xs) / len(xs)


def demand_stats(series):
    return mean(series), math.sqrt(pvariance(series))


def target_for(mu, sigma, lead, z):
    lt = max(lead, 1)
    return int(round_half_up(mu * lt + z * sigma * math.sqrt(lt)))


def safety_stock(sigma, lead, z):
    """The safety-stock part of target_for, rounded the same way, so a
    stage with an integer mean sits exactly at its target."""
    lt = max(lead, 1)
    return int(round_half_up(max(0.0, z * sigma * math.sqrt(lt))))


def quantile(sorted_xs, q):
    n = len(sorted_xs)
    if n == 0:
        return 0.0
    idx = int(round_half_up(q * (n - 1)))
    return sorted_xs[max(0, min(n - 1, idx))]


def median(xs):
    return quantile(sorted(xs), 0.5)


def opening_flow(demand):
    """The steady flow the chain opens with: the median of the first
    OPEN_WEEKS weeks of demand (the lower median for an even count)."""
    head = sorted(demand[:OPEN_WEEKS])
    return int(head[(len(head) - 1) // 2]) if head else 0


def stage_leads(order_delay, ship_delay):
    """Effective lead time of each stage (see the module notes)."""
    ship = max(int(ship_delay), 1)
    return [int(order_delay) + ship] * (STAGES - 1) + [ship]


def create_game(config, demand, policies):
    """Initial state. config keys: orderDelay, shipDelay, holdingCost,
    backlogCost, costModel ('backlog' or 'lost'), infoSharing (bool),
    serviceLevel (0 to 1). demand: the customer demand series (ints).
    policies: one policy dict per stage."""
    od, sd = int(config["orderDelay"]), int(config["shipDelay"])
    ship = max(sd, 1)
    weeks = len(demand)
    size = weeks + od + ship + 2
    flow = opening_flow(demand)
    inc = [[0] * size for _ in range(STAGES)]
    arr = [[0] * size for _ in range(STAGES)]
    for i in range(1, STAGES):
        for t in range(od):
            inc[i][t] = flow
    for i in range(STAGES):
        for t in range(ship):
            arr[i][t] = flow
    supply = []
    for i in range(STAGES):
        if i < STAGES - 1:
            supply.append(flow * od + flow * ship)
        else:
            supply.append(flow * ship)
    mu_d, sd_d = demand_stats(demand)
    z = norm_inv(float(config["serviceLevel"]))
    leads = stage_leads(od, sd)
    safety = [safety_stock(sd_d, lead, z) for lead in leads]
    return {
        "config": dict(config),
        "demand": list(demand),
        "policies": policies,
        "weeks": weeks,
        "t": 0,
        "inv": list(safety),
        "backlog": [0] * STAGES,
        "supply": supply,
        "inc": inc,
        "arr": arr,
        "arrCarry": [0] * STAGES,
        "hist": [[] for _ in range(STAGES)],
        "dHat": [float(flow)] * STAGES,
        "lastIncoming": [0] * STAGES,
        "orders": [[] for _ in range(STAGES)],
        "incomingLog": [[] for _ in range(STAGES)],
        "invLog": [[] for _ in range(STAGES)],
        "backlogLog": [[] for _ in range(STAGES)],
        "shipped": [0] * STAGES,
        "owed": [0] * STAGES,
        "lost": [0] * STAGES,
        "cost": [0.0] * STAGES,
        "customerReceived": 0,
        "demandMu": mu_d,
        "demandSd": sd_d,
        "z": z,
        "flow": flow,
        "leads": leads,
        "safety": safety,
    }


def _sched(sched, i, week, amount, state):
    """Add amount to arrivals of stage i at `week`; weeks already past
    (zero-delay scheduling after the stage's turn) go to the carry."""
    if amount == 0:
        return
    if week <= state["t"]:
        state["arrCarry"][i] += amount
    else:
        sched[i][week] += amount


def stage_plan(state, i):
    """(mu, S): the mean demand stage i plans against and its
    order-up-to target, under its information mode."""
    cfg = state["config"]
    seen = state["demand"][:state["t"] + 1] if cfg["infoSharing"] else state["hist"][i]
    p = int(cfg.get("forecastWeeks", FORECAST_WEEKS))
    window = seen[-p:] if p > 0 else seen
    mu = mean(window) if window else float(state["flow"])
    return mu, target_for(mu, state["demandSd"], state["leads"][i], state["z"])


def stage_target(state, i):
    """The order-up-to target for stage i under its information mode."""
    return stage_plan(state, i)[1]


def policy_order(state, i):
    """The order stage i's policy places at its turn in the current week.
    lastIncoming and hist must already include this week's order."""
    cfg = state["config"]
    pol = state["policies"][i]
    kind = pol["type"]
    inc = state["lastIncoming"][i]
    if kind == "passthrough":
        return int(inc)
    if kind == "scripted":
        orders = pol["orders"]
        return int(orders[state["t"]]) if state["t"] < len(orders) else 0
    if kind == "sterman":
        state["dHat"][i] = STERMAN_THETA * inc + (1.0 - STERMAN_THETA) * state["dHat"][i]
        target = stage_target(state, i)
        raw = state["dHat"][i] + STERMAN_ALPHA * (target - state["inv"][i] - STERMAN_BETA * state["supply"][i])
        return max(0, int(round_half_up(raw)))
    if kind == "out":
        alpha = float(pol.get("alpha", 1.0))
        mu, target = stage_plan(state, i)
        position = state["inv"][i] + state["supply"][i] - state["backlog"][i]
        return max(0, int(round_half_up(mu + alpha * (target - position - mu))))
    raise ValueError("unknown policy type: %s" % kind)


def process_stage(state, i, qty=None):
    """Run stage i's full turn for the current week. qty is the stage's
    order; if None, the stage's policy decides at step 5 of the turn,
    with this week's incoming order already received. (Deciding before
    the turn would hand every policy last week's information.)
    Returns the turn record."""
    cfg = state["config"]
    t = state["t"]
    od, sd = int(cfg["orderDelay"]), int(cfg["shipDelay"])
    # 1. arrivals
    arr = state["arr"][i][t] + state["arrCarry"][i]
    state["arrCarry"][i] = 0
    state["inv"][i] += arr
    state["supply"][i] -= arr
    # 2. incoming order
    inc = state["demand"][t] if i == 0 else state["inc"][i][t]
    state["lastIncoming"][i] = inc
    state["hist"][i].append(inc)
    state["incomingLog"][i].append(inc)
    owed = state["backlog"][i] + inc
    # 3. ship
    ship = min(state["inv"][i], owed)
    state["inv"][i] -= ship
    unfilled = owed - ship
    lost_now = 0
    if cfg["costModel"] == "lost":
        lost_now = unfilled
        state["lost"][i] += unfilled
        state["backlog"][i] = 0
        if i > 0 and unfilled:
            state["supply"][i - 1] -= unfilled
    else:
        state["backlog"][i] = unfilled
    if i > 0:
        _sched(state["arr"], i - 1, t + sd, ship, state)
    else:
        state["customerReceived"] += ship
    state["shipped"][i] += ship
    state["owed"][i] += owed
    # 4. costs
    if cfg["costModel"] == "lost":
        week_cost = cfg["holdingCost"] * state["inv"][i] + cfg["backlogCost"] * lost_now
    else:
        week_cost = cfg["holdingCost"] * state["inv"][i] + cfg["backlogCost"] * state["backlog"][i]
    state["cost"][i] += week_cost
    # 5. order
    if qty is None:
        qty = policy_order(state, i)
    qty = max(0, int(qty))
    state["orders"][i].append(qty)
    if i < STAGES - 1:
        state["inc"][i + 1][t + od] += qty
        state["supply"][i] += qty
    else:
        _sched(state["arr"], i, t + sd, qty, state)
        state["supply"][i] += qty
    state["invLog"][i].append(state["inv"][i])
    state["backlogLog"][i].append(state["backlog"][i])
    return {
        "stage": i, "arrived": arr, "incoming": inc, "shipped": ship,
        "unfilled": unfilled, "inv": state["inv"][i],
        "backlog": state["backlog"][i], "cost": week_cost, "order": qty,
    }


def step_week(state, orders=None):
    """Process every stage for the current week. orders: optional dict
    {stage: qty} overriding the stage's policy (human play, scripts);
    stages without an override follow their policy."""
    turns = []
    for i in range(STAGES):
        qty = orders[i] if orders is not None and i in orders else None
        turns.append(process_stage(state, i, qty))
    state["t"] += 1
    return turns


def simulate(config, demand, policies):
    """Run a full game and summarize it."""
    state = create_game(config, demand, policies)
    while state["t"] < state["weeks"]:
        step_week(state)
    dvar = pvariance([float(x) for x in state["demand"]])
    stages = []
    for i in range(STAGES):
        ovar = pvariance([float(x) for x in state["orders"][i]])
        stages.append({
            "orders": state["orders"][i],
            "incoming": state["incomingLog"][i],
            "invEnd": state["invLog"][i],
            "backlogEnd": state["backlogLog"][i],
            "shipped": state["shipped"][i],
            "owed": state["owed"][i],
            "lost": state["lost"][i],
            "cost": state["cost"][i],
            "fillRate": (state["shipped"][i] / state["owed"][i]) if state["owed"][i] else 1.0,
            "bullwhip": (ovar / dvar) if dvar > 0 else None,
        })
    return {
        "stages": stages,
        "chainCost": sum(state["cost"]),
        "demandVar": dvar,
        "customerReceived": state["customerReceived"],
    }


RULES = [
    {"key": "out", "name": "Order-up-to", "policy": {"type": "out", "alpha": 1.0}},
    {"key": "smooth", "name": "Order-up-to with smoothing", "policy": None},
    {"key": "pass", "name": "Pass-through", "policy": {"type": "passthrough"}},
]
SMOOTH_GRID = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]


def _policies_for(your_stage, your_policy):
    pols = [{"type": "out", "alpha": 1.0} for _ in range(STAGES)]
    pols[your_stage] = your_policy
    return pols


def _summarize(runs, your_stage):
    ys = your_stage
    return {
        "yourCost": median([r["stages"][ys]["cost"] for r in runs]),
        "yourCostLo": quantile(sorted(r["stages"][ys]["cost"] for r in runs), 0.1),
        "yourCostHi": quantile(sorted(r["stages"][ys]["cost"] for r in runs), 0.9),
        "chainCost": median([r["chainCost"] for r in runs]),
        "yourBullwhip": median([r["stages"][ys]["bullwhip"] for r in runs if r["stages"][ys]["bullwhip"] is not None]) if any(r["stages"][ys]["bullwhip"] is not None for r in runs) else None,
        "factoryBullwhip": median([r["stages"][STAGES - 1]["bullwhip"] for r in runs if r["stages"][STAGES - 1]["bullwhip"] is not None]) if any(r["stages"][STAGES - 1]["bullwhip"] is not None for r in runs) else None,
        "fillRate": median([r["stages"][ys]["fillRate"] for r in runs]),
        "yourOrders": runs[0]["stages"][ys]["orders"],
        "factoryOrders": runs[0]["stages"][STAGES - 1]["orders"],
    }


def evaluate_series(config, series_list, your_stage):
    """Run the three rules for your stage (teammates order-up-to) over
    every demand series, plus the smoothing curve, the information-sharing
    flip for the recommended rule, and the best rule under the other cost
    model. Returns everything the verdict and checks render."""
    out = {"rules": {}, "smoothCurve": []}
    for rule in RULES:
        if rule["key"] == "smooth":
            continue
        runs = [simulate(config, s, _policies_for(your_stage, rule["policy"])) for s in series_list]
        out["rules"][rule["key"]] = _summarize(runs, your_stage)
    curve = []
    for alpha in SMOOTH_GRID:
        runs = [simulate(config, s, _policies_for(your_stage, {"type": "out", "alpha": alpha})) for s in series_list]
        summ = _summarize(runs, your_stage)
        curve.append({"alpha": alpha, "yourCost": summ["yourCost"], "yourBullwhip": summ["yourBullwhip"]})
    # the smoothing winner: lowest cost, ties to the calmer rule
    best = None
    for pt in curve:
        key = (round(pt["yourCost"], 6), pt["yourBullwhip"] if pt["yourBullwhip"] is not None else 0.0)
        if best is None or key < best[0]:
            best = (key, pt)
    best_alpha = best[1]["alpha"]
    runs = [simulate(config, s, _policies_for(your_stage, {"type": "out", "alpha": best_alpha})) for s in series_list]
    smooth = _summarize(runs, your_stage)
    smooth["alpha"] = best_alpha
    out["rules"]["smooth"] = smooth
    out["smoothCurve"] = curve
    rec = recommend(out)
    out["recommendation"] = rec
    # information sharing flipped, recommended rule only
    flipped = dict(config)
    flipped["infoSharing"] = not config["infoSharing"]
    pol = _rule_policy(out, rec["rule"])
    runs = [simulate(flipped, s, _policies_for(your_stage, pol)) for s in series_list]
    alt = _summarize(runs, your_stage)
    out["sharingAlt"] = {"factoryBullwhip": alt["factoryBullwhip"], "yourCost": alt["yourCost"]}
    # best rule under the other cost model
    other = dict(config)
    other["costModel"] = "lost" if config["costModel"] == "backlog" else "backlog"
    alt_rules = {}
    for rule in RULES:
        p = _rule_policy(out, rule["key"]) if rule["key"] == "smooth" else rule["policy"]
        runs = [simulate(other, s, _policies_for(your_stage, p)) for s in series_list]
        alt_rules[rule["key"]] = _summarize(runs, your_stage)["yourCost"]
    out["altModelBest"] = min(alt_rules, key=lambda k: alt_rules[k])
    out["altModelCosts"] = alt_rules
    # the target the checks strip quotes (full-information target)
    mu, sigma = demand_stats(series_list[0])
    lead = stage_leads(config["orderDelay"], config["shipDelay"])[your_stage]
    out["lead"] = lead
    out["target"] = target_for(mu, sigma, lead, norm_inv(float(config["serviceLevel"])))
    out["safety"] = safety_stock(sigma, lead, norm_inv(float(config["serviceLevel"])))
    out["demandMu"] = mu
    out["demandSd"] = sigma
    return out


def _rule_policy(evaluation, key):
    if key == "out":
        return {"type": "out", "alpha": 1.0}
    if key == "pass":
        return {"type": "passthrough"}
    return {"type": "out", "alpha": evaluation["rules"]["smooth"]["alpha"]}


def recommend(evaluation):
    """Pick the rule to recommend from an evaluate_series result.
    cls: 'good' (clear winner), 'accent' (near tie), 'warn' (the best
    rule still leaves many orders unfilled)."""
    rules = evaluation["rules"]
    ranked = sorted(rules, key=lambda k: rules[k]["yourCost"])
    # smoothing at full strength (factor 1.0) is plain order-up-to, not a
    # second rule: it cannot be the runner-up that makes a tie
    if "out" in rules and rules.get("smooth", {}).get("alpha") == 1.0:
        ranked = [k for k in ranked if k != "smooth"]
    # a near tie (within 2% of the cheapest) breaks toward the calmer orders
    band = [k for k in ranked if rules[k]["yourCost"] <= rules[ranked[0]]["yourCost"] * 1.02]
    tie = len(band) > 1

    def calm(k):
        b = rules[k].get("yourBullwhip")
        return 0.0 if b is None else b
    best_key = min(band, key=calm)
    best = rules[best_key]
    others = [k for k in ranked if k != best_key]
    if best["fillRate"] < 0.75:
        cls = "warn"
    elif tie:
        cls = "accent"
    else:
        cls = "good"
    return {"rule": best_key, "cls": cls, "tie": tie, "runnerUp": others[0] if others else None}
