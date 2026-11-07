import type { CaseType, UrgencyLevel } from "@/types/complaint";

export interface ClassificationResult {
  category: string;
  caseType: CaseType;
  urgencyLevel: UrgencyLevel;
  recommendedAction: string;
  /** Legacy 0-100 value used by the existing persistence paths. */
  confidence: number;
  /** Softmax model scores on 0-1 (normalized, not calibrated). */
  categoryConfidence: number;
  caseTypeConfidence: number;
  urgencyConfidence: number;
  recommendationConfidence: number;
  model: string;
  fallback?: boolean;
}

export const MODEL_VERSION: string;
export const CATEGORIES: string[];
export const URGENCY_LEVELS: UrgencyLevel[];

export function classifyComplaint(
  description: string,
  categoryHint?: string
): ClassificationResult;
