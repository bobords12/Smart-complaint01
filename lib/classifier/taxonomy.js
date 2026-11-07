/**
 * The project's classification taxonomy and the documented business
 * rules that turn ONE model prediction into the four results shown to
 * the resident.
 *
 * Pipeline (see lib/classifier/index.js for the wiring):
 *
 *   text -> [TF-IDF + Naive Bayes, category model]  -> category + categoryConfidence
 *        -> [category -> case-type taxonomy rule]   -> caseType + caseTypeConfidence
 *        -> [TF-IDF + Naive Bayes, urgency model]   -> urgencyLevel + urgencyConfidence
 *        -> [urgency-first action rule]             -> recommendedAction + recommendationConfidence
 *
 * Only category and urgency are model predictions. Case type and
 * recommended action are rules applied on top, and their confidences
 * are rule certainties combined with the model confidences they
 * depend on — they are never presented as independent model outputs.
 */

export const MODEL_VERSION = "tfidf-nb-v1";

/**
 * Granular complaint categories. The first 11 are the labels the
 * original keyword prototype used; "Threat", "Illegal Activity" and
 * "Administrative Concern" were added because complaints of those
 * kinds had no home in the original list; "Other" is the catch-all.
 */
export const CATEGORIES = [
  "Noise Disturbance",
  "Animal Nuisance",
  "Physical Injury",
  "Threat",
  "Theft",
  "Vandalism",
  "Domestic Dispute",
  "Fence Boundary Conflict",
  "Illegal Parking",
  "Street Light Out",
  "Garbage Collection",
  "Construction Debris",
  "Administrative Concern",
  "Illegal Activity",
  "Other",
];

/**
 * Category -> case type. The database's case_category enum only holds
 * Criminal / Civil / Administrative (supabase/manual/01_extensions_
 * and_enums.sql), so the granular category maps onto that official
 * taxonomy. The certainty is how firmly the taxonomy fixes the case
 * type for that category — a business-rule certainty, not a model
 * probability.
 */
const CASE_TYPE_MAP = {
  "Noise Disturbance": { caseType: "Civil", certainty: 0.9 },
  "Animal Nuisance": { caseType: "Administrative", certainty: 0.9 },
  "Physical Injury": { caseType: "Criminal", certainty: 0.97 },
  Threat: { caseType: "Criminal", certainty: 0.97 },
  Theft: { caseType: "Criminal", certainty: 0.98 },
  Vandalism: { caseType: "Criminal", certainty: 0.92 },
  "Domestic Dispute": { caseType: "Civil", certainty: 0.9 },
  "Fence Boundary Conflict": { caseType: "Civil", certainty: 0.95 },
  "Illegal Parking": { caseType: "Administrative", certainty: 0.94 },
  "Street Light Out": { caseType: "Administrative", certainty: 0.96 },
  "Garbage Collection": { caseType: "Administrative", certainty: 0.96 },
  "Construction Debris": { caseType: "Administrative", certainty: 0.92 },
  "Administrative Concern": { caseType: "Administrative", certainty: 0.95 },
  "Illegal Activity": { caseType: "Criminal", certainty: 0.95 },
  // "Other" is explicitly undetermined — a low certainty is the
  // honest answer, not a confident Administrative default.
  Other: { caseType: "Administrative", certainty: 0.6 },
};

/** Official urgency levels (urgency_level enum: Critical/High/Normal). */
export const URGENCY_LEVELS = ["Critical", "High", "Normal"];

/**
 * Recommended action rules, in precedence order. These are the four
 * actions the original prototype defined; the escalation order
 * (immediate danger first, then criminal, then civil mediation, then
 * routine barangay review) is unchanged.
 */
const ACTION_RULES = [
  {
    action: "Immediate Barangay Review",
    when: (caseType, urgency) => urgency === "Critical",
    certainty: 0.97,
    drivenBy: "urgency",
  },
  {
    action: "Barangay Review & PNP Referral",
    when: (caseType) => caseType === "Criminal",
    certainty: 0.95,
    drivenBy: "caseType",
  },
  {
    action: "Mediation Hearing",
    when: (caseType) => caseType === "Civil",
    certainty: 0.95,
    drivenBy: "caseType",
  },
  {
    action: "Barangay Review",
    when: () => true,
    certainty: 0.93,
    drivenBy: "caseType",
  },
];

export function mapCaseType(category) {
  return CASE_TYPE_MAP[category] ?? CASE_TYPE_MAP.Other;
}

export function recommendAction(caseType, urgency) {
  for (const rule of ACTION_RULES) {
    if (rule.when(caseType, urgency)) return rule;
  }
  return ACTION_RULES[ACTION_RULES.length - 1];
}

/**
 * Build the four-field structured result from raw model outputs.
 *
 * @param {object}  input
 * @param {string}  input.category          category model prediction
 * @param {number}  input.categoryConfidence softmax score, 0-1
 * @param {Record<string, number>} input.categoryProbabilities all classes
 * @param {string}  input.urgency           urgency model prediction
 * @param {number}  input.urgencyConfidence softmax score, 0-1
 * @param {boolean} [input.fallback]        true when no known terms matched
 */
export function buildResult({ category, categoryConfidence, urgency, urgencyConfidence, fallback = false }) {
  const { caseType, certainty: typeCertainty } = mapCaseType(category);
  const rule = recommendAction(caseType, urgency);

  // Case type confidence: taxonomy certainty scaled by how confident
  // the model is about the category the mapping hangs on.
  const caseTypeConfidence = clamp01(typeCertainty * categoryConfidence);

  // Recommended action confidence: the certainty of the rule that
  // fired, scaled by the confidence of the input that decided it
  // (urgency when the escalation rule fired, otherwise case type).
  const decidingConfidence = rule.drivenBy === "urgency" ? urgencyConfidence : caseTypeConfidence;
  const recommendationConfidence = clamp01(rule.certainty * decidingConfidence);

  return {
    category,
    categoryConfidence: round4(categoryConfidence),
    caseType,
    caseTypeConfidence: round4(caseTypeConfidence),
    urgencyLevel: urgency,
    urgencyConfidence: round4(urgencyConfidence),
    recommendedAction: rule.action,
    recommendationConfidence: round4(recommendationConfidence),
    // Legacy field kept for the existing persistence paths, which
    // divide it by 100 into prediction_confidence numeric(5,4).
    confidence: Math.round(clamp01(categoryConfidence) * 100),
    model: MODEL_VERSION,
    fallback: fallback || undefined,
  };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function round4(x) {
  return Math.round(clamp01(x) * 10000) / 10000;
}
