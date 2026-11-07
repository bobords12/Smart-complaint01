/**
 * Complaint classifier entry point.
 *
 * One shared implementation behind every complaint surface (resident
 * form, staff-assisted encoding, kiosk, API route):
 *
 *   text -> featurize (preprocess.js)
 *         -> category model (naiveBayes.js, trained on trainingData.js)
 *         -> urgency model  (naiveBayes.js, trained on trainingData.js)
 *         -> buildResult    (taxonomy.js: case type + action rules)
 *
 * Both models train once, lazily, on first use (a few hundred small
 * documents — milliseconds) and are cached for the process lifetime.
 *
 * Honest confidence: the numbers returned are softmax (normalized
 * model) scores on 0-1, not calibrated real-world probabilities, and
 * case-type / action confidences are rule certainties combined with
 * the model confidences they depend on. When no known term matches
 * the text at all, the classifier returns "Other" at the documented
 * no-signal floor instead of inventing a confident answer.
 */

import { featurize } from "./preprocess.js";
import { trainClassifier, predictClassifier } from "./naiveBayes.js";
import { buildResult, MODEL_VERSION, CATEGORIES, URGENCY_LEVELS } from "./taxonomy.js";
import trainingData from "./trainingData.js";

/** Documented confidence when nothing in the vocabulary matched. */
const FALLBACK_CATEGORY_CONFIDENCE = 0.4;
const FALLBACK_URGENCY_CONFIDENCE = 0.35;

let models = null;

function ensureModels() {
  if (models) return models;
  const examples = trainingData.examples;
  const docs = examples.map((ex) => featurize(ex.text));
  models = {
    category: trainClassifier(docs, examples.map((ex) => ex.category)),
    urgency: trainClassifier(docs, examples.map((ex) => ex.urgency)),
  };
  return models;
}

/**
 * Classify one complaint description.
 *
 * @param {string} description free-text complaint narrative
 * @param {string} [_categoryHint] accepted for backward compatibility
 *   with the old keyword classifier; the model does not use it.
 * @returns {object} structured result (see taxonomy.buildResult)
 */
export function classifyComplaint(description, _categoryHint) {
  const text = typeof description === "string" ? description.trim() : "";
  const feats = featurize(text);
  const { category: categoryModel, urgency: urgencyModel } = ensureModels();

  const categoryPrediction = predictClassifier(categoryModel, feats);

  if (categoryPrediction.matchedTerms === 0) {
    return buildResult({
      category: "Other",
      categoryConfidence: FALLBACK_CATEGORY_CONFIDENCE,
      urgency: "Normal",
      urgencyConfidence: FALLBACK_URGENCY_CONFIDENCE,
      fallback: true,
    });
  }

  const urgencyPrediction = predictClassifier(urgencyModel, feats);

  return buildResult({
    category: categoryPrediction.label,
    categoryConfidence: categoryPrediction.probabilities[categoryPrediction.label],
    urgency: urgencyPrediction.label,
    urgencyConfidence: urgencyPrediction.probabilities[urgencyPrediction.label],
    fallback: false,
  });
}

export { MODEL_VERSION, CATEGORIES, URGENCY_LEVELS };
