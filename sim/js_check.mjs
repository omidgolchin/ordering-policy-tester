/* Runs the fixed agreement games through the JavaScript engine and
 * prints the results as JSON. tests/test_js_agreement.py compares them
 * with the Python engine (sim/chain.py) on the same games. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../docs/chain.js");

const games = [
  { config: { orderDelay: 1, shipDelay: 2, holdingCost: 0.5, backlogCost: 1.0, costModel: "backlog", infoSharing: false, serviceLevel: 0.95 },
    demand: Array(4).fill(4).concat(Array(32).fill(8)),
    policies: [{ type: "out", alpha: 1.0 }, { type: "out", alpha: 1.0 }, { type: "out", alpha: 1.0 }, { type: "out", alpha: 1.0 }] },
  { config: { orderDelay: 0, shipDelay: 1, holdingCost: 0.25, backlogCost: 2.0, costModel: "lost", infoSharing: false, serviceLevel: 0.9 },
    demand: [5, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12],
    policies: [{ type: "sterman" }, { type: "passthrough" }, { type: "out", alpha: 0.5 }, { type: "scripted", orders: Array(36).fill(7) }] },
  { config: { orderDelay: 0, shipDelay: 0, holdingCost: 1.0, backlogCost: 0.75, costModel: "backlog", infoSharing: true, serviceLevel: 0.99 },
    demand: [0, 3, 0, 6, 2, 0, 0, 9, 4, 4, 1, 0, 7, 7, 2, 0, 3, 3, 0, 5, 8, 1, 1, 0, 0, 4, 6, 2, 9, 0, 1, 1, 3, 0, 2, 5],
    policies: [{ type: "out", alpha: 0.4 }, { type: "sterman" }, { type: "passthrough" }, { type: "out", alpha: 1.0 }] }
];
const out = games.map((g) => C.simulate(g.config, g.demand, g.policies));
const ev = C.evaluateSeries(games[0].config, [games[0].demand], 0);
console.log(JSON.stringify({
  games: out,
  ev: { rules: ev.rules, recommendation: ev.recommendation, target: ev.target, sharingAlt: ev.sharingAlt, altModelBest: ev.altModelBest, smoothCurve: ev.smoothCurve }
}));
