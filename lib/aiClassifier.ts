import { classifyComplaint as classify } from "@/lib/classifier";

export type { ClassificationResult } from "@/lib/classifier";

/**
 * Thin typed facade over lib/classifier so existing imports
 * (`@/lib/aiClassifier`) keep working. The real model lives in
 * lib/classifier: TF-IDF weighted Multinomial Naive Bayes trained on
 * the curated complaint narratives in lib/classifier/trainingData.js.
 */
export function classifyComplaint(description: string, categoryHint?: string) {
  return classify(description, categoryHint);
}

export { MODEL_VERSION } from "@/lib/classifier";
