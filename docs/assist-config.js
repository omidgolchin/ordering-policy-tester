/* The AI assist's prompt configuration: what the model is asked to extract.
 * Shared by the page (app.js) and the extraction test (scripts/eval_assist.js),
 * so the test scores exactly the prompt visitors get. */
(function (g) {
  "use strict";
  var ASSIST_CONFIG = {
    title: "Fill from my description.",
    lede: "Describe your ordering setup in your own words: where you sit in the chain, how long orders and deliveries take, and what storage and shortages cost you. The model fills in the settings it can find, quotes your words for each one, and lists what you did not state.",
    placeholder: "e.g. I order for our wholesale business. Our distributor takes a week to process our orders, then goods take two weeks to reach us. Holding a unit costs about $0.50 a week; being short costs $1 per unit per week.",
    examples: [
      { label: "A full description", text: "I run ordering for a distributor. Orders take a week to reach the factory, production and shipping take three more weeks. Holding a unit costs $0.35 per week, and every unit-week we are short costs $1.20. The last eight weeks of orders from our customers were 22, 25, 21, 27, 30, 28, 26, 31." },
      { label: "A short one", text: "I order for our retail shop. Total lead time is three weeks and storage is cheap, but a stock-out loses us the sale." }
    ],
    instructions: [
      "You extract supply-chain ordering settings from a short description the user wrote about their own operation. You do not compute results, costs, bullwhip ratios, targets, or recommendations, and you never invent a number the text does not support.",
      "The tool models one stage of a four-stage chain: retailer, then wholesaler, then distributor, then factory. The 'stage' is the speaker's own position. Work it out from who they buy from and who they sell to: someone who sells to shoppers or walk-in customers is the retailer; someone who orders from a distributor is the wholesaler; someone who orders from the factory (or sits between the factory and the wholesalers) is the distributor; someone who manufactures the product is the factory.",
      "Lead time has two parts in the tool. orderDelay is how long the speaker's order takes to reach their supplier (processing and paperwork time, in weeks). shipDelay is how long goods take to arrive once shipped or produced (in weeks). If the text gives only one total lead time with no split, put the whole total in shipDelay and set orderDelay to 0.",
      "holdingCost and backlogCost are per unit per week. If holding cost is stated per day, multiply by 7 to get the weekly figure; if per year, divide by 52. backlogCost is the cost of being one unit short for a week, or the cost per lost sale if the text frames it that way; use the stated figure either way.",
      "demand is a series of weekly customer demand numbers. Fill it only when the text lists a run of numbers, one per week (for example 'the last six weeks were 12, 15, 11, 14, 13, 16'). A single average ('we sell about 40 a week') or a pattern in words ('it doubles in December') is not a series: leave demand out.",
      "Times stated in weeks are used as-is, including halves ('two and a half weeks' is 2.5). Leave any field the text does not pin down out of the answer entirely."
    ].join("\n"),
    fields: [
      { key: "orderDelay", label: "Order delay (weeks)", type: "number", hint: "How long your order takes to reach your supplier, in weeks. Part of the total lead time." },
      { key: "shipDelay", label: "Shipping delay (weeks)", type: "number", hint: "How long goods take to arrive once shipped or produced, in weeks. A single total lead time with no split goes here, with order delay 0." },
      { key: "holdingCost", label: "Holding cost ($ per unit per week)", type: "number", hint: "Per unit per week. Per-day figures are multiplied by 7, per-year figures divided by 52." },
      { key: "backlogCost", label: "Shortage cost ($ per unit per week)", type: "number", hint: "Cost of being one unit short for a week, or per lost sale if the text says that." },
      { key: "stage", label: "Your stage", type: "text", hint: "One of retailer, wholesaler, distributor, factory: the speaker's own position in the chain." },
      { key: "demand", label: "Weekly demand series", type: "array", hint: "One number per week, only when the text lists them." }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ASSIST_CONFIG;
  g.ASSIST_CONFIG = ASSIST_CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
