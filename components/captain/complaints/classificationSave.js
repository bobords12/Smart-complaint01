/**
 * Two separately authorized writes. A lost response cannot prove whether the
 * first write committed; the caller refreshes before retrying. Once the saved
 * broad decision and review are visible, only the missing specific value is
 * retried, so the broad review and audit event are not repeated.
 */
export async function saveClassificationParts({ existingDecision, needsSpecific, confirmBroad, confirmSpecific }) {
  let broadConfirmed = existingDecision;
  if (!existingDecision) {
    try {
      const result = await confirmBroad();
      if (!result?.success) return { status: "broad_unknown" };
      broadConfirmed = result.confirmed;
    } catch {
      return { status: "broad_unknown" };
    }
  }

  if (broadConfirmed && needsSpecific) {
    try {
      const result = await confirmSpecific();
      if (!result?.success) return { status: "specific_unknown" };
    } catch {
      return { status: "specific_unknown" };
    }
  }

  return { status: "saved", changed: !existingDecision || (broadConfirmed && needsSpecific) };
}
