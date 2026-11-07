/**
 * Held-out evaluation for the complaint classifier.
 *
 * Usage: npm run evaluate:classifier
 *
 * Trains on trainingData.js (as the app does) and scores on the
 * unseen phrasings in testData.js. Reports accuracy, per-class
 * precision / recall / F1, the confusion matrix, and how confidence
 * relates to correctness. Nothing here is used for training.
 */

import { classifyComplaint } from "../lib/classifier/index.js";
import trainingData from "../lib/classifier/trainingData.js";
import testData from "../lib/classifier/testData.js";

const examples = testData.examples;

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function metricsFor(key, field) {
  const labels = [...new Set(examples.map((ex) => ex[field]))].sort();
  const confusion = new Map();
  const stats = new Map(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));

  let correct = 0;
  const correctConfidences = [];
  const wrongConfidences = [];
  const errors = [];

  for (const ex of examples) {
    const result = classifyComplaint(ex.text);
    const predicted = result[key];
    const actual = ex[field];
    const confidence =
      key === "category" ? result.categoryConfidence : result.urgencyConfidence;

    if (!confusion.has(actual)) confusion.set(actual, new Map());
    const row = confusion.get(actual);
    row.set(predicted, (row.get(predicted) || 0) + 1);

    if (predicted === actual) {
      correct += 1;
      correctConfidences.push(confidence);
      stats.get(actual).tp += 1;
    } else {
      wrongConfidences.push(confidence);
      stats.get(actual).fn += 1;
      if (stats.has(predicted)) stats.get(predicted).fp += 1;
      errors.push({ text: ex.text, actual, predicted, confidence });
    }
  }

  const perClass = {};
  for (const [label, { tp, fp, fn }] of stats) {
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[label] = { precision, recall, f1, support: tp + fn };
  }

  const macroF1 =
    Object.values(perClass).reduce((s, m) => s + m.f1, 0) / Object.keys(perClass).length;

  return {
    accuracy: correct / examples.length,
    macroF1,
    perClass,
    confusion,
    errors,
    meanConfCorrect:
      correctConfidences.length === 0
        ? 0
        : correctConfidences.reduce((a, b) => a + b, 0) / correctConfidences.length,
    meanConfWrong:
      wrongConfidences.length === 0
        ? 0
        : wrongConfidences.reduce((a, b) => a + b, 0) / wrongConfidences.length,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function printReport(title, report, labels) {
  console.log(`\n=== ${title} ===`);
  console.log(`accuracy: ${pct(report.accuracy)}   macro-F1: ${report.macroF1.toFixed(3)}`);
  console.log(
    `mean confidence when correct: ${pct(report.meanConfCorrect)}` +
      (report.errors.length > 0
        ? `   when wrong: ${pct(report.meanConfWrong)}`
        : "")
  );
  console.log("");

  const w1 = Math.max(...labels.map((l) => l.length), 8);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad("class", w1)}  ${pad("prec", 6)} ${pad("rec", 6)} ${pad("f1", 6)} ${pad("sup", 4)}`
  );
  for (const label of labels) {
    const m = report.perClass[label];
    if (!m) continue;
    console.log(
      `${pad(label, w1)}  ${pct(m.precision).padStart(6)} ${pct(m.recall).padStart(6)} ` +
        `${m.f1.toFixed(3).padStart(6)} ${String(m.support).padStart(4)}`
    );
  }

  console.log("\nconfusion matrix (rows = actual, cols = predicted):");
  const cw = Math.max(...labels.map((l) => l.length), 5);
  console.log(`${" ".repeat(cw + 1)}${labels.map((l) => pad(l.slice(0, cw), cw + 1)).join("")}`);
  for (const actual of labels) {
    const row = report.confusion.get(actual);
    const cells = labels.map((p) => String(row?.get(p) || 0).padStart(cw + 1));
    console.log(`${pad(actual.slice(0, cw), cw + 1)}${cells.join("")}`);
  }

  if (report.errors.length > 0) {
    console.log(`\nmisclassified (${report.errors.length}):`);
    for (const e of report.errors) {
      console.log(
        `  [${e.actual}] -> [${e.predicted}] (${pct(e.confidence)})  "${e.text.slice(0, 90)}"`
      );
    }
  }
}

// ---------------------------------------------------------------------
// run
// ---------------------------------------------------------------------

console.log(
  `training examples: ${trainingData.examples.length}   ` +
    `held-out examples: ${examples.length}`
);

const categoryLabels = [...new Set(examples.map((e) => e.category))].sort();
printReport("CATEGORY", metricsFor("category", "category"), categoryLabels);

const urgencyLabels = [...new Set(examples.map((e) => e.urgency))].sort();
printReport("URGENCY", metricsFor("urgencyLevel", "urgency"), urgencyLabels);

// case type and recommended action are rules on top of the two models;
// score them against the taxonomy applied to the ACTUAL labels, which
// measures rule consistency rather than model quality.
const { mapCaseType, recommendAction } = await import("../lib/classifier/taxonomy.js");
let typeCorrect = 0;
let actionCorrect = 0;
for (const ex of examples) {
  const r = classifyComplaint(ex.text);
  const expectedType = mapCaseType(ex.category).caseType;
  const expectedRule = recommendAction(expectedType, ex.urgency);
  if (r.caseType === expectedType) typeCorrect += 1;
  if (r.recommendedAction === expectedRule.action) actionCorrect += 1;
}
console.log("\n=== RULE LAYER (vs taxonomy applied to actual labels) ===");
console.log(`case type accuracy:         ${pct(typeCorrect / examples.length)}`);
console.log(`recommended action accuracy: ${pct(actionCorrect / examples.length)}`);
