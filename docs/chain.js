/* Supply Chain Ordering Policy Tester: simulation engine.
 *
 * Mirrors sim/chain.py exactly; tests/test_js_agreement.py checks the
 * two agree on fixed games.
 *
 * The chain has four stages: 0 retailer, 1 wholesaler, 2 distributor,
 * 3 factory. Customer demand arrives at the retailer. Each week, stages
 * act in downstream-to-upstream order, and each stage's turn is:
 *
 *   1. Goods arrivals land in inventory (shipments sent shipDelay weeks
 *      ago, or, for the factory, production finished shipDelay weeks
 *      after the factory ordered it). An arrival scheduled for the
 *      current week after this step has already run (only possible
 *      with a zero delay) is carried to the stage's next turn.
 *   2. The stage receives its incoming order: customer demand for the
 *      retailer, otherwise the order the downstream stage placed
 *      orderDelay weeks ago. With orderDelay 0, an order placed this
 *      week is seen by the upstream stage later in the same week.
 *   3. The stage ships min(inventory, owed). Owed is the new order plus
 *      any backlog. Under the backlog cost model the unfilled rest
 *      stays owed; under lost sales it is cancelled (and the downstream
 *      stage's supply line shrinks by the cancelled amount).
 *   4. Costs: holding cost on end-of-week inventory, plus backlog cost
 *      per unit-week of backlog (backlog model) or per unit lost
 *      (lost sales).
 *   5. The stage places its order (its policy decides, with this week's
 *      incoming order already in). Orders reach the upstream stage
 *      after orderDelay weeks; the factory's production orders
 *      complete after shipDelay weeks.
 *
 * The chain opens in steady state: the opening flow F is the median of
 * the first four weeks of demand, every pipeline is full at F a week, and
 * every stage starts with its safety stock on hand, so steady demand
 * keeps the chain exactly steady. Lead times are effective: a stage's is
 * orderDelay + max(shipDelay, 1) (a shipment lands at the earliest the
 * week after it is made); the factory's is max(shipDelay, 1).
 *
 * Inventory position = on-hand inventory + supply line - backlog.
 *
 * Policies: passthrough (order the incoming order), out (order-up-to,
 * mu + alpha * (S - position - mu), with mu the stage's demand estimate:
 * alpha 1 is the plain rule, smaller alpha the proportional order-up-to
 * rule of Disney and Towill, which in steady state orders exactly demand),
 * sterman (Sterman 1989 anchoring heuristic, theta 0.36, alpha 0.26,
 * beta 0.34), scripted (a fixed list of orders, by week).
 *
 * The order-up-to target is S = mu * L + z * sigma * sqrt(L), with L the
 * stage's lead time and sigma the spread of customer demand: the safety
 * stock is set at planning time and held fixed. mu is customer demand's
 * mean with information sharing, otherwise the running mean of the
 * stage's own incoming orders.
 */
(function (g) {
  "use strict";

  var STAGES = 4;
  var OPEN_WEEKS = 4; /* the opening flow is the median of this many first weeks */
  var FORECAST_WEEKS = 8; /* default moving-average window for the demand forecast */
  var STERMAN_THETA = 0.36, STERMAN_ALPHA = 0.26, STERMAN_BETA = 0.34;

  function roundHalfUp(x) { return Math.floor(x + 0.5); }

  function normCdf(x) {
    var t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    var tail = Math.exp(-x * x / 2.0) / Math.sqrt(2.0 * Math.PI) * poly;
    return x >= 0 ? 1.0 - tail : tail;
  }
  function normInv(p) {
    var lo = -10.0, hi = 10.0;
    for (var k = 0; k < 100; k++) {
      var mid = (lo + hi) / 2.0;
      if (normCdf(mid) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2.0;
  }
  function mean(xs) {
    if (!xs.length) return 0.0;
    var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }
  function pvariance(xs) {
    if (!xs.length) return 0.0;
    var m = mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return s / xs.length;
  }
  function demandStats(series) { return [mean(series), Math.sqrt(pvariance(series))]; }
  function targetFor(mu, sigma, lead, z) {
    var lt = Math.max(lead, 1);
    return roundHalfUp(mu * lt + z * sigma * Math.sqrt(lt));
  }
  function safetyStock(sigma, lead, z) {
    var lt = Math.max(lead, 1);
    return roundHalfUp(Math.max(0.0, z * sigma * Math.sqrt(lt)));
  }
  function openingFlow(demand) {
    var head = demand.slice(0, OPEN_WEEKS).sort(function (a, b) { return a - b; });
    return head.length ? head[Math.floor((head.length - 1) / 2)] | 0 : 0;
  }
  function stageLeads(od, sd) {
    var ship = Math.max(sd | 0, 1), out = [];
    for (var i = 0; i < STAGES - 1; i++) out.push((od | 0) + ship);
    out.push(ship);
    return out;
  }
  function quantile(sortedXs, q) {
    var n = sortedXs.length;
    if (!n) return 0.0;
    var idx = roundHalfUp(q * (n - 1));
    return sortedXs[Math.max(0, Math.min(n - 1, idx))];
  }
  function median(xs) { return quantile(xs.slice().sort(function (a, b) { return a - b; }), 0.5); }
  function sortedCopy(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }

  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }

  function createGame(config, demand, policies) {
    var od = config.orderDelay | 0, sd = config.shipDelay | 0, ship = Math.max(sd, 1);
    var weeks = demand.length;
    var size = weeks + od + ship + 2;
    var flow = openingFlow(demand);
    var inc = [], arr = [], supply = [], i, t;
    for (i = 0; i < STAGES; i++) { inc.push(zeros(size)); arr.push(zeros(size)); }
    for (i = 1; i < STAGES; i++) for (t = 0; t < od; t++) inc[i][t] = flow;
    for (i = 0; i < STAGES; i++) for (t = 0; t < ship; t++) arr[i][t] = flow;
    for (i = 0; i < STAGES; i++) supply.push(i < STAGES - 1 ? flow * od + flow * ship : flow * ship);
    var ds = demandStats(demand);
    var z = normInv(config.serviceLevel), leads = stageLeads(od, sd);
    var safety = leads.map(function (L) { return safetyStock(ds[1], L, z); });
    return {
      config: Object.assign({}, config), demand: demand.slice(), policies: policies,
      weeks: weeks, t: 0,
      inv: safety.slice(), backlog: [0, 0, 0, 0], supply: supply,
      inc: inc, arr: arr, arrCarry: [0, 0, 0, 0],
      hist: [[], [], [], []], dHat: [flow, flow, flow, flow],
      lastIncoming: [0, 0, 0, 0],
      orders: [[], [], [], []], incomingLog: [[], [], [], []],
      invLog: [[], [], [], []], backlogLog: [[], [], [], []],
      shipped: [0, 0, 0, 0], owed: [0, 0, 0, 0], lost: [0, 0, 0, 0],
      cost: [0.0, 0.0, 0.0, 0.0], customerReceived: 0,
      demandMu: ds[0], demandSd: ds[1],
      z: z, flow: flow, leads: leads, safety: safety
    };
  }

  function sched(state, i, week, amount) {
    if (!amount) return;
    if (week <= state.t) state.arrCarry[i] += amount;
    else state.arr[i][week] += amount;
  }

  function stagePlan(state, i) {
    var seen = state.config.infoSharing ? state.demand.slice(0, state.t + 1) : state.hist[i];
    var p = state.config.forecastWeeks == null ? FORECAST_WEEKS : state.config.forecastWeeks | 0;
    var win = p > 0 ? seen.slice(-p) : seen;
    var mu = win.length ? mean(win) : state.flow;
    return [mu, targetFor(mu, state.demandSd, state.leads[i], state.z)];
  }
  function stageTarget(state, i) { return stagePlan(state, i)[1]; }

  function policyOrder(state, i) {
    var pol = state.policies[i], kind = pol.type, inc = state.lastIncoming[i];
    if (kind === "passthrough") return inc | 0;
    if (kind === "scripted") return state.t < pol.orders.length ? pol.orders[state.t] | 0 : 0;
    if (kind === "sterman") {
      state.dHat[i] = STERMAN_THETA * inc + (1.0 - STERMAN_THETA) * state.dHat[i];
      var target = stageTarget(state, i);
      var raw = state.dHat[i] + STERMAN_ALPHA * (target - state.inv[i] - STERMAN_BETA * state.supply[i]);
      return Math.max(0, roundHalfUp(raw));
    }
    if (kind === "out") {
      var alpha = pol.alpha == null ? 1.0 : pol.alpha;
      var plan = stagePlan(state, i), mu = plan[0], s = plan[1];
      var position = state.inv[i] + state.supply[i] - state.backlog[i];
      return Math.max(0, roundHalfUp(mu + alpha * (s - position - mu)));
    }
    throw new Error("unknown policy type: " + kind);
  }

  function processStage(state, i, qty) {
    var cfg = state.config, t = state.t;
    var od = cfg.orderDelay | 0, sd = cfg.shipDelay | 0;
    var arrAmt = state.arr[i][t] + state.arrCarry[i];
    state.arrCarry[i] = 0;
    state.inv[i] += arrAmt;
    state.supply[i] -= arrAmt;
    var inc = i === 0 ? state.demand[t] : state.inc[i][t];
    state.lastIncoming[i] = inc;
    state.hist[i].push(inc);
    state.incomingLog[i].push(inc);
    var owed = state.backlog[i] + inc;
    var ship = Math.min(state.inv[i], owed);
    state.inv[i] -= ship;
    var unfilled = owed - ship, lostNow = 0;
    if (cfg.costModel === "lost") {
      lostNow = unfilled;
      state.lost[i] += unfilled;
      state.backlog[i] = 0;
      if (i > 0 && unfilled) state.supply[i - 1] -= unfilled;
    } else {
      state.backlog[i] = unfilled;
    }
    if (i > 0) sched(state, i - 1, t + sd, ship);
    else state.customerReceived += ship;
    state.shipped[i] += ship;
    state.owed[i] += owed;
    var weekCost = cfg.costModel === "lost"
      ? cfg.holdingCost * state.inv[i] + cfg.backlogCost * lostNow
      : cfg.holdingCost * state.inv[i] + cfg.backlogCost * state.backlog[i];
    state.cost[i] += weekCost;
    if (qty === null || qty === undefined) qty = policyOrder(state, i);
    qty = Math.max(0, qty | 0);
    state.orders[i].push(qty);
    if (i < STAGES - 1) { state.inc[i + 1][t + od] += qty; state.supply[i] += qty; }
    else { sched(state, i, t + sd, qty); state.supply[i] += qty; }
    state.invLog[i].push(state.inv[i]);
    state.backlogLog[i].push(state.backlog[i]);
    return { stage: i, arrived: arrAmt, incoming: inc, shipped: ship, unfilled: unfilled, inv: state.inv[i], backlog: state.backlog[i], cost: weekCost, order: qty };
  }

  function stepWeek(state, orders) {
    var turns = [];
    for (var i = 0; i < STAGES; i++) {
      var qty = orders && Object.prototype.hasOwnProperty.call(orders, i) ? orders[i] : null;
      turns.push(processStage(state, i, qty));
    }
    state.t += 1;
    return turns;
  }

  function simulate(config, demand, policies) {
    var state = createGame(config, demand, policies);
    while (state.t < state.weeks) stepWeek(state);
    var dvar = pvariance(state.demand), stages = [], i;
    for (i = 0; i < STAGES; i++) {
      var ovar = pvariance(state.orders[i]);
      stages.push({
        orders: state.orders[i], incoming: state.incomingLog[i],
        invEnd: state.invLog[i], backlogEnd: state.backlogLog[i],
        shipped: state.shipped[i], owed: state.owed[i], lost: state.lost[i],
        cost: state.cost[i],
        fillRate: state.owed[i] ? state.shipped[i] / state.owed[i] : 1.0,
        bullwhip: dvar > 0 ? ovar / dvar : null
      });
    }
    var chain = 0; for (i = 0; i < STAGES; i++) chain += state.cost[i];
    return { stages: stages, chainCost: chain, demandVar: dvar, customerReceived: state.customerReceived };
  }

  /* ---------------- demand patterns (page-side generation) ---------------- */
  function makeRng(seed) {
    var a = seed >>> 0, spare = null;
    function next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function normal() {
      if (spare !== null) { var v = spare; spare = null; return v; }
      var u, v2, s;
      do { u = next() * 2 - 1; v2 = next() * 2 - 1; s = u * u + v2 * v2; } while (s >= 1 || s === 0);
      var m = Math.sqrt(-2 * Math.log(s) / s); spare = v2 * m; return u * m;
    }
    return { next: next, normal: normal };
  }
  var patterns = {
    step: function (weeks) {
      var d = [], t;
      for (t = 0; t < weeks; t++) d.push(t < 4 ? 4 : 8);
      return d;
    },
    seasonal: function (weeks) {
      var d = [], t;
      for (t = 0; t < weeks; t++) d.push(Math.max(0, roundHalfUp(8 + 4 * Math.sin(2 * Math.PI * t / 12))));
      return d;
    },
    constant: function (weeks, level) {
      var d = [], t;
      for (t = 0; t < weeks; t++) d.push(level || 6);
      return d;
    },
    randomSeries: function (weeks, seed) {
      var rng = makeRng(seed), d = [], t;
      for (t = 0; t < weeks; t++) d.push(Math.max(0, roundHalfUp(8 + 3 * rng.normal())));
      return d;
    }
  };

  /* ---------------- comparison ---------------- */
  var RULES = [
    { key: "out", name: "Order-up-to", policy: { type: "out", alpha: 1.0 } },
    { key: "smooth", name: "Order-up-to with smoothing", policy: null },
    { key: "pass", name: "Pass-through", policy: { type: "passthrough" } }
  ];
  var SMOOTH_GRID = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  function policiesFor(yourStage, yourPolicy) {
    var pols = [], i;
    for (i = 0; i < STAGES; i++) pols.push({ type: "out", alpha: 1.0 });
    pols[yourStage] = yourPolicy;
    return pols;
  }
  function summarize(runs, ys) {
    function col(fn) { return runs.map(fn); }
    function medBw(idx) {
      var vals = runs.map(function (r) { return r.stages[idx].bullwhip; }).filter(function (x) { return x !== null; });
      return vals.length ? median(vals) : null;
    }
    return {
      yourCost: median(col(function (r) { return r.stages[ys].cost; })),
      yourCostLo: quantile(sortedCopy(col(function (r) { return r.stages[ys].cost; })), 0.1),
      yourCostHi: quantile(sortedCopy(col(function (r) { return r.stages[ys].cost; })), 0.9),
      chainCost: median(col(function (r) { return r.chainCost; })),
      yourBullwhip: medBw(ys),
      factoryBullwhip: medBw(STAGES - 1),
      fillRate: median(col(function (r) { return r.stages[ys].fillRate; })),
      yourOrders: runs[0].stages[ys].orders,
      factoryOrders: runs[0].stages[STAGES - 1].orders
    };
  }
  function rulePolicy(evaluation, key) {
    if (key === "out") return { type: "out", alpha: 1.0 };
    if (key === "pass") return { type: "passthrough" };
    return { type: "out", alpha: evaluation.rules.smooth.alpha };
  }
  function evaluateSeries(config, seriesList, yourStage) {
    var out = { rules: {}, smoothCurve: [] }, r, key;
    for (r = 0; r < RULES.length; r++) {
      if (RULES[r].key === "smooth") continue;
      var pol = RULES[r].policy;
      var runs = seriesList.map(function (s) { return simulate(config, s, policiesFor(yourStage, pol)); });
      out.rules[RULES[r].key] = summarize(runs, yourStage);
    }
    var curve = [], best = null;
    SMOOTH_GRID.forEach(function (alpha) {
      var runs = seriesList.map(function (s) { return simulate(config, s, policiesFor(yourStage, { type: "out", alpha: alpha })); });
      var summ = summarize(runs, yourStage);
      var pt = { alpha: alpha, yourCost: summ.yourCost, yourBullwhip: summ.yourBullwhip };
      curve.push(pt);
      var k = [roundHalfUp(summ.yourCost * 1000000) / 1000000, summ.yourBullwhip === null ? 0.0 : summ.yourBullwhip];
      if (!best || k[0] < best.k[0] || (k[0] === best.k[0] && k[1] < best.k[1])) best = { k: k, pt: pt };
    });
    var runsS = seriesList.map(function (s) { return simulate(config, s, policiesFor(yourStage, { type: "out", alpha: best.pt.alpha })); });
    var smooth = summarize(runsS, yourStage);
    smooth.alpha = best.pt.alpha;
    out.rules.smooth = smooth;
    out.smoothCurve = curve;
    var rec = recommend(out);
    out.recommendation = rec;
    var flipped = Object.assign({}, config); flipped.infoSharing = !config.infoSharing;
    var polR = rulePolicy(out, rec.rule);
    var runsF = seriesList.map(function (s) { return simulate(flipped, s, policiesFor(yourStage, polR)); });
    var alt = summarize(runsF, yourStage);
    out.sharingAlt = { factoryBullwhip: alt.factoryBullwhip, yourCost: alt.yourCost };
    var other = Object.assign({}, config);
    other.costModel = config.costModel === "backlog" ? "lost" : "backlog";
    var altCosts = {};
    for (r = 0; r < RULES.length; r++) {
      key = RULES[r].key;
      var p2 = key === "smooth" ? rulePolicy(out, "smooth") : RULES[r].policy;
      var runsA = seriesList.map(function (s) { return simulate(other, s, policiesFor(yourStage, p2)); });
      altCosts[key] = summarize(runsA, yourStage).yourCost;
    }
    var altBest = null;
    Object.keys(altCosts).forEach(function (k2) { if (altBest === null || altCosts[k2] < altCosts[altBest]) altBest = k2; });
    out.altModelBest = altBest;
    out.altModelCosts = altCosts;
    var ds = demandStats(seriesList[0]);
    var leadY = stageLeads(config.orderDelay, config.shipDelay)[yourStage];
    out.lead = leadY;
    out.target = targetFor(ds[0], ds[1], leadY, normInv(config.serviceLevel));
    out.safety = safetyStock(ds[1], leadY, normInv(config.serviceLevel));
    out.demandMu = ds[0];
    out.demandSd = ds[1];
    return out;
  }
  function recommend(evaluation) {
    var rules = evaluation.rules;
    var ranked = Object.keys(rules).sort(function (a, b) { return rules[a].yourCost - rules[b].yourCost; });
    /* smoothing at full strength (1.0) is plain order-up-to, not a second rule */
    if (rules.out && rules.smooth && rules.smooth.alpha === 1.0) ranked = ranked.filter(function (k) { return k !== "smooth"; });
    var band = ranked.filter(function (k) { return rules[k].yourCost <= rules[ranked[0]].yourCost * 1.02; });
    var tie = band.length > 1;
    /* a near tie (within 2% of the cheapest) breaks toward the calmer orders */
    var calm = function (k) { var b = rules[k].yourBullwhip; return b === null || b === undefined ? 0.0 : b; };
    var bestKey = band.reduce(function (a, k) { return calm(k) < calm(a) ? k : a; }, band[0]), best = rules[bestKey];
    var others = ranked.filter(function (k) { return k !== bestKey; });
    var cls = best.fillRate < 0.75 ? "warn" : (tie ? "accent" : "good");
    return { rule: bestKey, cls: cls, tie: tie, runnerUp: others.length ? others[0] : null };
  }

  var api = {
    STAGES: STAGES, OPEN_WEEKS: OPEN_WEEKS, FORECAST_WEEKS: FORECAST_WEEKS, openingFlow: openingFlow, stageLeads: stageLeads, safetyStock: safetyStock,
    STERMAN_THETA: STERMAN_THETA, STERMAN_ALPHA: STERMAN_ALPHA, STERMAN_BETA: STERMAN_BETA,
    roundHalfUp: roundHalfUp, normCdf: normCdf, normInv: normInv,
    mean: mean, pvariance: pvariance, demandStats: demandStats, targetFor: targetFor,
    quantile: quantile, median: median,
    createGame: createGame, stageTarget: stageTarget, policyOrder: policyOrder,
    processStage: processStage, stepWeek: stepWeek, simulate: simulate,
    makeRng: makeRng, patterns: patterns,
    RULES: RULES, SMOOTH_GRID: SMOOTH_GRID,
    evaluateSeries: evaluateSeries, recommend: recommend, rulePolicy: rulePolicy
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.ChainSim = api;
})(typeof window !== "undefined" ? window : globalThis);
