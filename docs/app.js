/* Supply Chain Ordering Policy Tester: page logic.
 * The simulation engine is chain.js (ChainSim); sim/chain.py mirrors it.
 * Compare mode scores three ordering rules at the visitor's stage.
 * Play mode runs one 36-week game with the visitor ordering by hand. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var WEEKS = 36, REPS = 20;
  var STAGE_NAMES = ["retailer", "wholesaler", "distributor", "factory"];
  var STAGE_TITLES = ["Retailer", "Wholesaler", "Distributor", "Factory"];
  var RULE_NAMES = { out: "Order-up-to", smooth: "Order-up-to with smoothing", pass: "Pass-through" };
  var OUT_POL = { type: "out", alpha: 1.0 };

  function fmtN(x, d) { return Tool.fmt.num(x, d); }
  function money(x) { return "$" + fmtN(x, 0); }
  function bw(x) { return x === null || x === undefined ? "–" : "×" + fmtN(x, 1); }
  function pct(x) { return fmtN(x * 100, 0) + "%"; }

  /* ---------------- examples ---------------- */
  var EXAMPLES = [
    { name: "The classic: demand steps up", note: "The Beer Game setup. Demand doubles in week 5 and stays there; watch what the rules do to the factory.",
      set: { stage: 0, orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 1, costModel: "backlog", serviceLevel: "0.95", demandPattern: "step", infoSharing: false, rules: ["out", "smooth", "pass"] } },
    { name: "Steady demand, same every week", note: "Nothing ever changes. The cheap rules tie, and pass-through's steady ordering suddenly looks expensive.",
      set: { stage: 0, orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 1, costModel: "backlog", serviceLevel: "0.95", demandPattern: "constant", infoSharing: false, rules: ["out", "smooth", "pass"] } },
    { name: "Jump demand, pricey stock-outs", note: "Random demand and a $2 shortage cost: the setting where smoothing earns its keep.",
      set: { stage: 0, orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 2, costModel: "backlog", serviceLevel: "0.95", demandPattern: "random", infoSharing: false, rules: ["out", "smooth", "pass"] } },
    { name: "Long lead time, pricey stock-outs", note: "Five weeks of lead time and a $4 shortage cost: the order-up-to target grows, and so does the damage when it is wrong.",
      set: { stage: 1, orderDelay: 2, shipDelay: 3, holdingCost: 0.5, backlogCost: 4, costModel: "backlog", serviceLevel: "0.95", demandPattern: "step", infoSharing: false, rules: ["out", "smooth", "pass"] } },
    { name: "Unfilled orders are lost sales", note: "Seasonal demand, and a stock-out loses the sale instead of backlogging it. The best rule can change; the verdict says if it does.",
      set: { stage: 0, orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 1.5, costModel: "lost", serviceLevel: "0.95", demandPattern: "seasonal", infoSharing: false, rules: ["out", "smooth", "pass"] } },
    { name: "Cheap storage, costly shortages", note: "Holding costs a dime, shortages cost $3: carry more, and let the target do the work, with the whole chain sharing demand.",
      set: { stage: 2, orderDelay: 1, shipDelay: 2, holdingCost: 0.1, backlogCost: 3, costModel: "backlog", serviceLevel: "0.99", demandPattern: "random", infoSharing: true, rules: ["out", "smooth", "pass"] } },
    { name: "Your own demand, pasted in", note: "A jagged 36-week series pasted into the demand box: the rules are scored on exactly this path.",
      set: { stage: 0, orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 1, costModel: "backlog", serviceLevel: "0.95", demandPattern: "custom", infoSharing: false, rules: ["out", "smooth", "pass"] } }
  ];

  function setVal(id, v) { var el = $(id); if (el) el.value = v; }
  function applyExample(i) {
    var s = EXAMPLES[i].set;
    setVal("stage", s.stage); setVal("orderDelay", s.orderDelay); setVal("shipDelay", s.shipDelay);
    setVal("holdingCost", s.holdingCost); setVal("backlogCost", s.backlogCost);
    setVal("costModel", s.costModel); setVal("serviceLevel", s.serviceLevel);
    setVal("demandPattern", s.demandPattern);
    $("infoSharing").checked = !!s.infoSharing;
    $("ruleOut").checked = s.rules.indexOf("out") >= 0;
    $("ruleSmooth").checked = s.rules.indexOf("smooth") >= 0;
    $("rulePass").checked = s.rules.indexOf("pass") >= 0;
    $("exampleNote").textContent = EXAMPLES[i].note || "";
    syncCustomVisibility();
  }
  function syncCustomVisibility() { $("demandCustomWrap").hidden = $("demandPattern").value !== "custom"; }

  /* ---------------- compare inputs ---------------- */
  function fieldError(id, msg) {
    var input = $(id), err = $(id + "Err");
    if (input) input.closest(".field").classList.toggle("invalid", !!msg);
    if (err) { err.textContent = msg || ""; err.hidden = !msg; }
    return !msg;
  }
  function numField(id, label, opts) {
    var raw = $(id).value.trim(), v = parseFloat(raw), ok = raw !== "" && isFinite(v);
    if (ok && opts.int) { ok = Math.abs(v - Math.round(v)) < 1e-9; v = Math.round(v); }
    if (ok && (v < opts.min || v > opts.max)) ok = false;
    fieldError(id, ok ? "" : label + " must be " + (opts.int ? "a whole number " : "a number ") + "between " + opts.min + " and " + opts.max + ".");
    return ok ? v : null;
  }
  function parseCustomDemand() {
    var text = $("demandCustom").value;
    var parts = text.split(/[^0-9.]+/).filter(function (p) { return p !== ""; });
    var vals = parts.map(function (p) { return parseFloat(p); });
    if (!vals.length || vals.some(function (v) { return !isFinite(v) || v < 0 || v > 10000; })) {
      fieldError("demand", "Weekly demand must be numbers between 0 and 10,000.");
      return null;
    }
    if (vals.length < 8 || vals.length > 52) {
      fieldError("demand", "Paste between 8 and 52 weekly numbers (you pasted " + vals.length + ").");
      return null;
    }
    fieldError("demand", "");
    return vals.map(function (v) { return Math.round(v); });
  }
  function demandSeriesList(pattern) {
    if (pattern === "step") return [ChainSim.patterns.step(WEEKS)];
    if (pattern === "constant") return [ChainSim.patterns.constant(WEEKS, 6)];
    if (pattern === "seasonal") return [ChainSim.patterns.seasonal(WEEKS)];
    if (pattern === "random") {
      var list = [], i;
      for (i = 0; i < REPS; i++) list.push(ChainSim.patterns.randomSeries(WEEKS, 1000 + i));
      return list;
    }
    var custom = parseCustomDemand();
    return custom ? [custom] : null;
  }
  function checkedRules() {
    var keys = [];
    if ($("ruleOut").checked) keys.push("out");
    if ($("ruleSmooth").checked) keys.push("smooth");
    if ($("rulePass").checked) keys.push("pass");
    return keys;
  }

  /* readInputs validates everything; on problems it marks the fields
   * and returns them, so the verdict can say what is wrong. */
  function readInputs() {
    var problems = [];
    var od = numField("orderDelay", "Order delay", { min: 0, max: 8, int: true });
    var sd = numField("shipDelay", "Shipping delay", { min: 0, max: 8, int: true });
    var hc = numField("holdingCost", "Holding cost", { min: 0, max: 100 });
    var bc = numField("backlogCost", "Shortage cost", { min: 0, max: 100 });
    if (od === null || sd === null || hc === null || bc === null) problems.push("a highlighted number is out of range");
    if (od !== null && sd !== null && od + sd > 12) {
      fieldError("shipDelay", "Lead time over 12 weeks leaves a 36-week game mostly waiting; keep the total at 12 or under.");
      problems.push("the total lead time is over 12 weeks");
    }
    if (hc === 0 && bc === 0) {
      fieldError("backlogCost", "Holding and shortage costs cannot both be zero: nothing would be scored.");
      problems.push("both costs are zero");
    }
    var pattern = $("demandPattern").value;
    var seriesList = demandSeriesList(pattern);
    if (!seriesList) problems.push("the pasted demand needs fixing");
    var rules = checkedRules();
    if (!rules.length) problems.push("tick at least one rule to compare");
    if (problems.length) return { problems: problems };
    return {
      problems: [],
      config: { orderDelay: od, shipDelay: sd, holdingCost: hc, backlogCost: bc,
                costModel: $("costModel").value, infoSharing: $("infoSharing").checked,
                serviceLevel: parseFloat($("serviceLevel").value) },
      stage: parseInt($("stage").value, 10),
      pattern: pattern, seriesList: seriesList, rules: rules
    };
  }

  function policiesFor(stage, pol) {
    var a = [OUT_POL, OUT_POL, OUT_POL, OUT_POL];
    a[stage] = pol;
    return a;
  }
  /* Median factory bullwhip of one rule under a tweaked config. */
  function altFactoryBullwhip(config, seriesList, stage, pol) {
    var vals = seriesList.map(function (s) {
      return ChainSim.simulate(config, s, policiesFor(stage, pol)).stages[3].bullwhip;
    }).filter(function (x) { return x !== null; });
    return vals.length ? ChainSim.median(vals) : null;
  }
  function altBestRule(config, seriesList, stage, ev, allowed) {
    var best = null, costs = {};
    allowed.forEach(function (key) {
      var pol = ChainSim.rulePolicy(ev, key);
      var med = ChainSim.median(seriesList.map(function (s) {
        return ChainSim.simulate(config, s, policiesFor(stage, pol)).stages[stage].cost;
      }));
      costs[key] = med;
      if (best === null || med < costs[best]) best = key;
    });
    return { best: best, costs: costs };
  }

  /* ---------------- verdict ---------------- */
  var view = { chartSeries: null, curve: null, summary: "", playSeries: null };

  function ruleTitle(key, ev) {
    if (key === "pass") return "Order exactly what was ordered from you (pass-through)";
    if (key === "out") return "Use order-up-to with a target of " + ev.target + " units";
    return "Use order-up-to with smoothing " + fmtN(ev.rules.smooth.alpha, 1) + " and a target of " + ev.target + " units";
  }
  function pickRecommendation(ev, allowed) {
    var keys = allowed.slice().sort(function (a, b) { return ev.rules[a].yourCost - ev.rules[b].yourCost; });
    var best = keys[0];
    var tie = keys.length > 1 && ev.rules[keys[1]].yourCost <= ev.rules[best].yourCost * 1.02;
    var cls = ev.rules[best].fillRate < 0.75 ? "warn" : (tie ? "accent" : "good");
    return { rule: best, cls: cls, tie: tie, runnerUp: keys.length > 1 ? keys[1] : null };
  }

  function renderBad(problems) {
    var panel = $("verdictPanel");
    panel.className = "panel verdict v-bad";
    $("vKicker").textContent = "Check your settings";
    $("vTitle").textContent = "The verdict needs " + problems[0] + ".";
    $("vBody").textContent = "Fix the highlighted settings and the verdict comes back. Nothing is simulated with impossible inputs.";
    $("vKpis").innerHTML = "";
    $("vChecks").innerHTML = "";
    view.summary = "";
  }

  function renderVerdict(inp, ev) {
    var rec = pickRecommendation(ev, inp.rules);
    var R = ev.rules[rec.rule], stageName = STAGE_TITLES[inp.stage];
    var nWeeks = inp.seriesList[0].length;
    var lead = inp.config.orderDelay + inp.config.shipDelay;
    var panel = $("verdictPanel");
    panel.className = "panel verdict v-" + rec.cls;
    $("vKicker").textContent = "Recommended rule · " + stageName.toLowerCase() + " · " + nWeeks + " weeks";
    $("vTitle").textContent = ruleTitle(rec.rule, ev);

    var body = "Your stage pays " + money(R.yourCost) + " in holding and shortage costs over the game";
    if (inp.seriesList.length > 1) body += " — the median of " + inp.seriesList.length + " simulated demand paths; the middle 80% of paths land between " + money(R.yourCostLo) + " and " + money(R.yourCostHi);
    body += ". ";
    if (rec.rule !== "pass") {
      var P = ev.rules.pass;
      body += "Pass-through would cost " + money(P.yourCost) + " at your stage and sends the factory a bullwhip of " + bw(P.factoryBullwhip) + "; this rule keeps the factory at " + bw(R.factoryBullwhip) + ". ";
    } else {
      body += "Your orders stay exactly as steady as demand (bullwhip ×1.0 at your stage), and no target-based rule beats it on cost here. ";
    }
    if (rec.cls === "warn") {
      body += "Even so, about " + pct(1 - R.fillRate) + " of the orders reaching you go unfilled over the game while the chain catches up. Raising the service level, shortening the lead time, or sharing demand helps more than switching rules.";
    } else if (rec.cls === "accent" && rec.runnerUp) {
      body += RULE_NAMES[rec.runnerUp] + " lands within a couple of percent (" + money(ev.rules[rec.runnerUp].yourCost) + "), so either is a reasonable pick; the tie breaks toward the calmer orders.";
    } else {
      body += "It fills " + pct(R.fillRate) + " of the orders reaching you.";
    }
    $("vBody").textContent = body;

    $("vKpis").innerHTML =
      '<div class="kpi"><span class="k-lbl">Your cost, ' + nWeeks + ' weeks</span><span class="k-val">' + money(R.yourCost) + "</span></div>" +
      '<div class="kpi"><span class="k-lbl">Bullwhip at your stage</span><span class="k-val">' + bw(R.yourBullwhip) + "</span></div>" +
      '<div class="kpi"><span class="k-lbl">Bullwhip at the factory</span><span class="k-val">' + bw(R.factoryBullwhip) + "</span></div>" +
      '<div class="kpi"><span class="k-lbl">Orders filled</span><span class="k-val">' + pct(R.fillRate) + "</span></div>";

    /* ---- built-in checks ---- */
    var checks = [];
    var muL = Math.round(ev.demandMu * Math.max(lead, 1));
    var safety = ev.target - muL;
    checks.push(["info", "TARGET", "Order-up-to target",
      "The target of " + ev.target + " units is " + Math.max(lead, 1) + " weeks of demand (" + muL + ") plus safety stock (" + safety + ") for a " + pct(inp.config.serviceLevel) + " service level." +
      (rec.rule === "pass" ? " Pass-through itself uses no target." : "")]);
    var pol = ChainSim.rulePolicy(ev, rec.rule);
    var flippedCfg = Object.assign({}, inp.config, { infoSharing: !inp.config.infoSharing });
    var altBw = altFactoryBullwhip(flippedCfg, inp.seriesList, inp.stage, pol);
    if (altBw !== null && R.factoryBullwhip !== null) {
      if (!inp.config.infoSharing && altBw < R.factoryBullwhip * 0.8) {
        checks.push(["warn", "SHARING OFF", "Information sharing",
          "Sharing customer demand with every stage would cut the factory's bullwhip from " + bw(R.factoryBullwhip) + " to " + bw(altBw) + ". Each stage is currently guessing demand from the orders it receives (Lee, Padmanabhan and Whang, 1997)."]);
      } else if (inp.config.infoSharing && altBw > R.factoryBullwhip * 1.25) {
        checks.push(["ok", "SHARING ON", "Information sharing",
          "Sharing is doing its work: without it the factory's bullwhip would be " + bw(altBw) + " instead of " + bw(R.factoryBullwhip) + "."]);
      } else {
        checks.push(["info", "SHARING", "Information sharing",
          "Sharing demand barely moves the factory's bullwhip here: " + bw(R.factoryBullwhip) + " with the current setting, " + bw(altBw) + " without. Amplification is not always about missing information."]);
      }
    }
    var otherModel = inp.config.costModel === "backlog" ? "lost" : "backlog";
    var altCfg = Object.assign({}, inp.config, { costModel: otherModel });
    var alt = altBestRule(altCfg, inp.seriesList, inp.stage, ev, inp.rules);
    if (alt.best && alt.best !== rec.rule) {
      checks.push(["warn", "COST MODEL", "Backlog or lost sales?",
        "If unfilled orders were " + (otherModel === "lost" ? "lost sales" : "backlogs") + " instead, " + RULE_NAMES[alt.best] + " would be the cheapest rule at your stage (" + money(alt.costs[alt.best]) + "). The best rule depends on what a stock-out really is in your business."]);
    } else if (alt.best) {
      checks.push(["info", "COST MODEL", "Backlog or lost sales?",
        RULE_NAMES[rec.rule] + " stays cheapest if unfilled orders are treated as " + (otherModel === "lost" ? "lost sales" : "backlogs") + " too."]);
    }
    if (inp.rules.indexOf("smooth") >= 0) {
      var atOne = null;
      ev.smoothCurve.forEach(function (p) { if (p.alpha === 1.0) atOne = p; });
      var bestPt = ev.smoothCurve[0];
      ev.smoothCurve.forEach(function (p) { if (p.yourCost < bestPt.yourCost) bestPt = p; });
      if (atOne) {
        checks.push([rec.rule === "smooth" ? "ok" : "info", "SMOOTHING", "The smoothing trade-off",
          "Smoothing " + fmtN(bestPt.alpha, 1) + " gives your bullwhip " + bw(bestPt.yourBullwhip) + " at " + money(bestPt.yourCost) + "; the full-strength rule (1.0) gives " + bw(atOne.yourBullwhip) + " at " + money(atOne.yourCost) + ". The full curve is in 'The smoothing trade-off' below."]);
      }
    }
    $("vChecks").innerHTML = checks.map(function (c) {
      return '<li class="check is-' + c[0] + '"><span class="c-badge">' + c[1] + '</span><span class="c-text"><strong>' + c[2] + ".</strong> " + c[3] + "</span></li>";
    }).join("");

    view.summary = $("vTitle").textContent + " At the " + STAGE_TITLES[inp.stage].toLowerCase() + ", over " + nWeeks + " weeks: your cost " + money(R.yourCost) +
      ", bullwhip at your stage " + bw(R.yourBullwhip) + ", at the factory " + bw(R.factoryBullwhip) + ", orders filled " + pct(R.fillRate) + ".";

    renderNumbers(inp, ev, rec);
    drawCompareChart(inp, ev, rec);
    drawCurves(ev);
  }

  function renderNumbers(inp, ev, rec) {
    var rows = ["out", "smooth", "pass"].map(function (key) {
      var r = ev.rules[key];
      var compared = inp.rules.indexOf(key) >= 0;
      var name = RULE_NAMES[key] + (key === "smooth" ? " (" + fmtN(r.alpha, 1) + ")" : "");
      return '<tr class="' + (key === rec.rule ? "rec" : "") + (compared ? "" : " dim") + '"><td>' + name +
        (key === rec.rule ? " (recommended)" : compared ? "" : " (not compared)") + "</td><td>" + money(r.yourCost) + "</td><td>" +
        money(r.chainCost) + "</td><td>" + bw(r.yourBullwhip) + "</td><td>" + bw(r.factoryBullwhip) + "</td><td>" + pct(r.fillRate) + "</td></tr>";
    }).join("");
    $("numbersBody").innerHTML =
      '<table class="numbers"><thead><tr><th>Rule</th><th>Your cost</th><th>Whole-chain cost</th><th>Your bullwhip</th><th>Factory bullwhip</th><th>Filled</th></tr></thead><tbody>' +
      rows + "</tbody></table>" +
      '<p class="dim">Costs are holding plus shortage costs over ' + inp.seriesList[0].length + ' weeks. With random demand, each figure is the median over ' + inp.seriesList.length + ' demand paths. The other stages always use plain order-up-to; only your stage\'s rule changes.</p>';
  }

  function seriesFrom(orders, name, color, dash) {
    return { name: name, color: color, dash: dash || null, points: orders.map(function (y, i) { return { x: i + 1, y: y }; }) };
  }
  function drawCompareChart(inp, ev, rec) {
    var demand = inp.seriesList[0];
    var R = ev.rules[rec.rule], P = ev.rules.pass;
    var series = [seriesFrom(demand, "Customer demand", "neutral", "4 3")];
    series.push(seriesFrom(R.yourOrders, "Your orders (" + RULE_NAMES[rec.rule].toLowerCase() + ")", "accent"));
    if (rec.rule !== "pass") series.push(seriesFrom(P.yourOrders, "Your orders (pass-through)", "series2", "6 4"));
    series.push(seriesFrom(R.factoryOrders, "Factory orders (" + RULE_NAMES[rec.rule].toLowerCase() + ")", "series3"));
    if (rec.rule !== "pass") series.push(seriesFrom(P.factoryOrders, "Factory orders (pass-through)", "series4", "6 4"));
    view.chartSeries = series;
    Tool.lineChart($("orderChart"), series, { xLabel: "Week", yLabel: "Units ordered per week", yMin: 0 });
    $("chartNote").textContent = inp.seriesList.length > 1
      ? "One of the " + inp.seriesList.length + " simulated demand paths; the verdict and costs use all of them."
      : "The simulated demand path behind the verdict.";
  }
  function redrawCompareChart() { if (view.chartSeries) Tool.lineChart($("orderChart"), view.chartSeries, { xLabel: "Week", yLabel: "Units ordered per week", yMin: 0 }); }

  function drawCurves(ev) {
    view.curve = ev.smoothCurve;
    var anyBw = ev.smoothCurve.some(function (p) { return p.yourBullwhip !== null; });
    Tool.lineChart($("curveCostChart"),
      [{ name: "Your cost", color: "accent", points: ev.smoothCurve.map(function (p) { return { x: p.alpha, y: p.yourCost }; }) }],
      { xLabel: "Smoothing factor (share of the gap ordered each week)", yLabel: "Your cost ($)", yMin: 0 });
    if (anyBw) {
      Tool.lineChart($("curveBwChart"),
        [{ name: "Your bullwhip ratio", color: "series2", points: ev.smoothCurve.filter(function (p) { return p.yourBullwhip !== null; }).map(function (p) { return { x: p.alpha, y: p.yourBullwhip }; }) }],
        { xLabel: "Smoothing factor", yLabel: "Bullwhip ratio", yMin: 0 });
    } else {
      $("curveBwChart").innerHTML = '<p class="dim">Demand never varies in this setup, so a bullwhip ratio has nothing to divide by.</p>';
    }
  }
  function redrawCurves() { if (view.curve) drawCurves({ smoothCurve: view.curve }); }

  /* ---------------- URL state ---------------- */
  function currentParams() {
    return {
      ex: $("exampleSelect").value, stage: $("stage").value,
      od: $("orderDelay").value, sd: $("shipDelay").value,
      hc: $("holdingCost").value, bc: $("backlogCost").value,
      cm: $("costModel").value, svc: $("serviceLevel").value,
      dp: $("demandPattern").value, dc: $("demandCustom").value,
      sh: $("infoSharing").checked ? "1" : "0", rules: checkedRules().join(","),
      pr: $("playRole").value, pd: $("playDemand").value,
      ba: $("botA").value, bb: $("botB").value, bc2: $("botC").value,
      m: $("playMode").hidden ? "compare" : "play"
    };
  }
  function writeUrl() {
    /* URL state needs an http(s) page; opened as a local file the tool
     * simply skips it (the shared helper cannot parse a file: URL). */
    if (!/^https?:$/.test(location.protocol)) return;
    Tool.writeParams(currentParams());
  }
  function safeReadParams() {
    try { return Tool.readParams(); } catch (e) { return {}; }
  }

  var debounce = null, computing = false;
  function recompute() {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      if (computing) { recompute(); return; }
      computing = true;
      try {
        var inp = readInputs();
        if (inp.problems.length) { renderBad(inp.problems); return; }
        var ev = ChainSim.evaluateSeries(inp.config, inp.seriesList, inp.stage);
        renderVerdict(inp, ev);
      } finally {
        computing = false;
        writeUrl();
      }
    }, 120);
  }

  /* ---------------- play mode ---------------- */
  var BOT_OPTIONS = [
    { key: "out", name: "Order-up-to bot", policy: { type: "out", alpha: 1.0 } },
    { key: "smooth5", name: "Smoothing bot (0.5)", policy: { type: "out", alpha: 0.5 } },
    { key: "pass", name: "Pass-through bot", policy: { type: "passthrough" } },
    { key: "sterman", name: "Anchoring bot (Sterman)", policy: { type: "sterman" } }
  ];
  function botByKey(key) {
    for (var i = 0; i < BOT_OPTIONS.length; i++) if (BOT_OPTIONS[i].key === key) return BOT_OPTIONS[i];
    return BOT_OPTIONS[0];
  }
  function otherStages(role) { return [0, 1, 2, 3].filter(function (i) { return i !== role; }); }
  function syncBotLabels() {
    var role = parseInt($("playRole").value, 10);
    var others = otherStages(role), ids = ["botA", "botB", "botC"], labels = ["botALabel", "botBLabel", "botCLabel"];
    others.forEach(function (stageIdx, k) {
      $(labels[k]).textContent = STAGE_TITLES[stageIdx] + " (teammate)";
    });
  }
  function fillBotSelects() {
    ["botA", "botB", "botC"].forEach(function (id) {
      $(id).innerHTML = BOT_OPTIONS.map(function (b) { return '<option value="' + b.key + '">' + b.name + "</option>"; }).join("");
    });
    $("botA").value = "out"; $("botB").value = "out"; $("botC").value = "sterman";
  }
  function playBotPolicies() {
    var role = parseInt($("playRole").value, 10);
    var others = otherStages(role), ids = ["botA", "botB", "botC"];
    var pols = [null, null, null, null];
    others.forEach(function (stageIdx, k) { pols[stageIdx] = botByKey($(ids[k]).value).policy; });
    return { role: role, pols: pols };
  }

  var play = null;
  function startGame() {
    var inp = readInputs();
    if (inp.problems.length) {
      $("playStatus").textContent = "The Compare settings need fixing first (" + inp.problems[0] + "). Switch to Compare policies, fix the highlighted settings, then start again.";
      return;
    }
    var bp = playBotPolicies();
    var pattern = $("playDemand").value;
    var demand = pattern === "seasonal" ? ChainSim.patterns.seasonal(WEEKS)
      : pattern === "random" ? ChainSim.patterns.randomSeries(WEEKS, 5000 + Math.floor(Math.random() * 9000))
      : ChainSim.patterns.step(WEEKS);
    var pols = bp.pols.slice();
    pols[bp.role] = { type: "scripted", orders: [] }; /* replaced by hand each week */
    play = {
      state: ChainSim.createGame(inp.config, demand, pols),
      config: inp.config, role: bp.role, botPols: bp.pols,
      snapshot: null, preview: null, suggestion: 0, log: []
    };
    $("playEnd").innerHTML = "";
    $("playTitle").textContent = "You are the " + STAGE_TITLES[play.role].toLowerCase();
    renderPlayTiles();
    drawPlayChart();
    beginPlayerTurn();
  }

  function beginPlayerTurn() {
    var st = play.state, role = play.role, i;
    for (i = 0; i < role; i++) ChainSim.processStage(st, i);
    play.snapshot = JSON.stringify(st);
    st.policies[role] = { type: "out", alpha: 1.0 };
    play.preview = ChainSim.processStage(st, role);
    play.suggestion = play.preview.order;
    var pv = play.preview;
    var pipeline = st.supply[role] - play.suggestion;
    $("playTurn").hidden = false;
    $("playErr").hidden = true;
    $("playTitle").textContent = "Week " + (st.t + 1) + " of " + st.weeks + " — you are the " + STAGE_TITLES[role].toLowerCase();
    $("playTurnText").innerHTML =
      "<strong>Week " + (st.t + 1) + ".</strong> " + pv.arrived + " units arrived. " + pv.incoming + " were ordered from you; you shipped " + pv.shipped + "." +
      " You now hold <strong>" + pv.inv + "</strong> units" + (pv.backlog ? " and owe <strong>" + pv.backlog + "</strong>." : " and owe nothing.") +
      " " + pipeline + " units are on their way to you. Your running cost: " + money(st.cost[role]) + "." +
      " The order-up-to rule would order <strong>" + play.suggestion + "</strong>.";
    $("playOrder").value = play.suggestion;
    $("playStatus").textContent = "Your move: place this week's order.";
    $("playOrder").focus();
  }

  function submitOrder() {
    if (!play || !play.preview) return;
    var raw = $("playOrder").value.trim(), q = parseInt(raw, 10);
    if (raw === "" || !isFinite(q) || q < 0 || q > 999 || String(q) !== raw.replace(/^0+(?=\d)/, "")) {
      $("playErr").textContent = "Order a whole number between 0 and 999.";
      $("playErr").hidden = false;
      return;
    }
    $("playErr").hidden = true;
    var st = play.state, role = play.role, i;
    if (q !== play.suggestion) {
      play.state = JSON.parse(play.snapshot);
      st = play.state;
      ChainSim.processStage(st, role, q);
    }
    for (i = role + 1; i < 4; i++) ChainSim.processStage(st, i);
    st.t += 1;
    play.log.push("Week " + st.t + ": " + play.preview.incoming + " ordered from you, you ordered " + q + " · running cost " + money(st.cost[role]));
    $("playLog").innerHTML = play.log.slice(-4).join("<br>");
    play.preview = null;
    renderPlayTiles();
    drawPlayChart();
    if (st.t >= st.weeks) { $("playTurn").hidden = true; endGame(); }
    else beginPlayerTurn();
  }

  function renderPlayTiles() {
    var st = play.state;
    $("playStages").innerHTML = [0, 1, 2, 3].map(function (i) {
      var inv = st.invLog[i].length ? st.invLog[i][st.invLog[i].length - 1] : ChainSim.INIT_INV;
      var bl = st.backlogLog[i].length ? st.backlogLog[i][st.backlogLog[i].length - 1] : 0;
      var lastOrder = st.orders[i].length ? st.orders[i][st.orders[i].length - 1] : "–";
      var who = i === play.role ? "You" : botNameFor(i);
      return '<div class="stage-tile' + (i === play.role ? " you" : "") + '"><h3>' + STAGE_TITLES[i] + '</h3><p class="who">' + who + '</p>' +
        '<div class="invbar"><i style="width:' + Math.min(100, inv / 60 * 100) + '%"></i></div>' +
        '<p class="nums">Stock: ' + inv + ' · owed: <span class="bl-badge' + (bl ? "" : " zero") + '">' + bl + '</span><br>Last order: ' + lastOrder + " · cost so far: " + money(st.cost[i]) + "</p></div>";
    }).join("");
  }
  function botNameFor(stageIdx) {
    var role = play.role, others = otherStages(role), ids = ["botA", "botB", "botC"];
    var k = others.indexOf(stageIdx);
    return k >= 0 ? botByKey($(ids[k]).value).name : "";
  }

  function drawPlayChart() {
    if (!play) return;
    var st = play.state, n = Math.max(st.t, 1);
    var colors = ["accent", "series2", "series3", "series4"];
    var series = [{ name: "Customer demand", color: "neutral", dash: "4 3", points: st.demand.slice(0, n).map(function (y, i) { return { x: i + 1, y: y }; }) }];
    [0, 1, 2, 3].forEach(function (i) {
      series.push({ name: STAGE_TITLES[i] + " orders" + (i === play.role ? " (you)" : ""), color: colors[i],
        points: st.orders[i].map(function (y, w) { return { x: w + 1, y: y }; }) });
    });
    view.playSeries = series;
    Tool.lineChart($("playChart"), series, { xLabel: "Week", yLabel: "Units ordered per week", yMin: 0 });
  }
  function redrawPlayChart() { if (view.playSeries) Tool.lineChart($("playChart"), view.playSeries, { xLabel: "Week", yLabel: "Units ordered per week", yMin: 0 }); }

  function endGame() {
    var st = play.state, role = play.role;
    var yourCost = st.cost[role];
    var yourBw = ChainSim.pvariance(st.demand) > 0 ? ChainSim.pvariance(st.orders[role]) / ChainSim.pvariance(st.demand) : null;
    var fill = st.owed[role] ? st.shipped[role] / st.owed[role] : 1;
    var candidates = [{ key: "out", pol: OUT_POL }, { key: "pass", pol: { type: "passthrough" } }];
    ChainSim.SMOOTH_GRID.forEach(function (a) { candidates.push({ key: "smooth", pol: { type: "out", alpha: a }, alpha: a }); });
    var best = null;
    candidates.forEach(function (c) {
      var pols = play.botPols.slice(); pols[role] = c.pol;
      var r = ChainSim.simulate(play.config, st.demand, pols);
      var entry = { key: c.key, alpha: c.alpha, cost: r.stages[role].cost, bw: r.stages[role].bullwhip };
      if (!best || entry.cost < best.cost) best = entry;
    });
    var bestName = best.key === "smooth" ? "order-up-to with smoothing " + fmtN(best.alpha, 1) : best.key === "out" ? "plain order-up-to" : "pass-through";
    var cls = yourCost <= best.cost * 1.02 ? "good" : yourCost <= best.cost * 1.3 ? "accent" : "warn";
    var saved = best.cost - yourCost;
    $("playEnd").innerHTML =
      '<div class="verdict v-' + cls + '" style="margin-top:14px"><p class="v-kicker">Game over · 36 weeks as the ' + STAGE_TITLES[role].toLowerCase() + '</p>' +
      '<h3 class="v-title">Your ordering cost ' + money(yourCost) + '</h3>' +
      '<p class="v-body">The best rule on the same demand, with the same teammates, was ' + bestName + ' at ' + money(best.cost) +
      (saved >= 0 ? " — you beat it by " + money(saved) + ". Nicely judged." : " — " + money(-saved) + " less than you spent.") +
      " Your bullwhip ratio was " + bw(yourBw) + "; the best rule's was " + bw(best.bw) + ". You filled " + pct(fill) + " of the orders that reached you, and the whole chain spent " + money(st.cost[0] + st.cost[1] + st.cost[2] + st.cost[3]) + ".</p>" +
      '<div class="kpis"><div class="kpi"><span class="k-lbl">Your cost</span><span class="k-val">' + money(yourCost) + '</span></div>' +
      '<div class="kpi"><span class="k-lbl">Best rule</span><span class="k-val">' + money(best.cost) + '</span></div>' +
      '<div class="kpi"><span class="k-lbl">Your bullwhip</span><span class="k-val">' + bw(yourBw) + '</span></div>' +
      '<div class="kpi"><span class="k-lbl">Orders filled</span><span class="k-val">' + pct(fill) + "</span></div></div></div>";
    $("playStatus").textContent = "Game over. Start a new game to try another role, other teammates, or another demand pattern.";
    play.preview = null;
  }

  /* ---------------- modes ---------------- */
  function setMode(mode) {
    var playOn = mode === "play";
    $("playMode").hidden = !playOn;
    $("compareMode").hidden = playOn;
    $("modeCompare").setAttribute("aria-pressed", String(!playOn));
    $("modePlay").setAttribute("aria-pressed", String(playOn));
    writeUrl();
  }

  /* ---------------- assist ---------------- */
  function applyAssist(values) {
    if (values.orderDelay != null) setVal("orderDelay", values.orderDelay);
    if (values.shipDelay != null) setVal("shipDelay", values.shipDelay);
    if (values.holdingCost != null) setVal("holdingCost", values.holdingCost);
    if (values.backlogCost != null) setVal("backlogCost", values.backlogCost);
    if (values.stage) {
      var name = String(values.stage).toLowerCase();
      for (var i = 0; i < STAGE_NAMES.length; i++) if (name.indexOf(STAGE_NAMES[i]) >= 0) setVal("stage", i);
    }
    if (values.demand && values.demand.length) {
      setVal("demandPattern", "custom");
      $("demandCustom").value = values.demand.join(", ");
    }
    syncCustomVisibility();
    recompute();
  }

  /* ---------------- wiring and boot ---------------- */
  function redrawAll() { redrawCompareChart(); redrawCurves(); redrawPlayChart(); }
  function init() {
    var sel = $("exampleSelect");
    sel.innerHTML = EXAMPLES.map(function (e, i) { return '<option value="' + i + '">' + e.name + "</option>"; }).join("");
    fillBotSelects();

    var params = safeReadParams();
    var exIdx = parseInt(params.ex, 10);
    applyExample(isFinite(exIdx) && EXAMPLES[exIdx] ? exIdx : 0);
    sel.value = String(isFinite(exIdx) && EXAMPLES[exIdx] ? exIdx : 0);
    if (params.stage != null) setVal("stage", params.stage);
    if (params.od != null) setVal("orderDelay", params.od);
    if (params.sd != null) setVal("shipDelay", params.sd);
    if (params.hc != null) setVal("holdingCost", params.hc);
    if (params.bc != null) setVal("backlogCost", params.bc);
    if (params.cm != null) setVal("costModel", params.cm);
    if (params.svc != null) setVal("serviceLevel", params.svc);
    if (params.dp != null) setVal("demandPattern", params.dp);
    if (params.dc != null) $("demandCustom").value = params.dc;
    if (params.sh != null) $("infoSharing").checked = params.sh === "1";
    if (params.rules != null) {
      var rk = params.rules.split(",");
      $("ruleOut").checked = rk.indexOf("out") >= 0;
      $("ruleSmooth").checked = rk.indexOf("smooth") >= 0;
      $("rulePass").checked = rk.indexOf("pass") >= 0;
    }
    syncCustomVisibility();
    if (params.pr != null) setVal("playRole", params.pr);
    if (params.pd != null) setVal("playDemand", params.pd);
    syncBotLabels();
    if (params.ba) $("botA").value = params.ba;
    if (params.bb) $("botB").value = params.bb;
    if (params.bc2) $("botC").value = params.bc2;
    if (params.m === "play") setMode("play");

    sel.addEventListener("change", function () { applyExample(parseInt(sel.value, 10) || 0); recompute(); });
    ["stage", "orderDelay", "shipDelay", "holdingCost", "backlogCost", "costModel", "serviceLevel", "demandPattern", "demandCustom", "infoSharing", "ruleOut", "ruleSmooth", "rulePass"].forEach(function (id) {
      $(id).addEventListener("input", recompute);
      $(id).addEventListener("change", recompute);
    });
    $("demandPattern").addEventListener("change", syncCustomVisibility);
    $("copySummary").addEventListener("click", function () {
      if (!view.summary) return;
      Tool.copy(view.summary).then(function () {
        $("copiedNote").hidden = false;
        setTimeout(function () { $("copiedNote").hidden = true; }, 1600);
      });
    });
    $("copyLink").addEventListener("click", function () {
      writeUrl();
      Tool.copy(location.href).then(function () {
        $("copiedNote").hidden = false;
        setTimeout(function () { $("copiedNote").hidden = true; }, 1600);
      });
    });
    $("modeCompare").addEventListener("click", function () { setMode("compare"); });
    $("modePlay").addEventListener("click", function () { setMode("play"); });
    $("playRole").addEventListener("change", function () { syncBotLabels(); writeUrl(); });
    ["botA", "botB", "botC", "playDemand"].forEach(function (id) { $(id).addEventListener("change", writeUrl); });
    $("playStart").addEventListener("click", startGame);
    $("playSubmit").addEventListener("click", submitOrder);
    $("playOrder").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submitOrder(); } });

    var cfg = window.ASSIST_CONFIG;
    if (cfg && Tool.assist) Tool.assist(Object.assign({}, cfg, { mount: $("assistMount"), toggle: $("assistToggle"), apply: applyAssist }));

    if (window.KitTheme && KitTheme.onChange) KitTheme.onChange(redrawAll);
    var rz = null;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(redrawAll, 150); });

    recompute();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
