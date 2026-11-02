import { EvidencePool } from './evidence-pool';
import { CitationVerificationResult, Evidence } from './evidence.types';

export interface VerifyCitationsOptions {
  /**
   * Optional custom pattern to match citation tags.
   * If omitted, dynamically builds regex from the pool's ID prefix or defaults to any [prefix\d+] format.
   */
  tagPattern?: RegExp;
}

/**
 * Deterministic citation verification in TypeScript (Zero model calls).
 *
 * Scans generated answer text for bracketed citation tags (e.g. [e1], [e2], [e1, e2])
 * and dynamically verifies that every referenced ID exists in the EvidencePool.
 *
 * If any referenced ID does not exist in the pool, isValid is set to false with
 * invalidIds populated so Gate 2 can convert the response into an explicit abstention.
 */
export function verifyCitations(
  answerText: string,
  pool: EvidencePool,
  options?: VerifyCitationsOptions,
): CitationVerificationResult {
  const citations: Evidence[] = [];
  const invalidIds: string[] = [];
  const seenCitedIds = new Set<string>();

  const prefix = pool.getIdPrefix();
  // Dynamically build pattern for the pool prefix or generic alphanumeric ID format
  const citationRegex =
    options?.tagPattern ??
    new RegExp(
      `\\[\\s*([${prefix.toLowerCase()}${prefix.toUpperCase()}]\\d+(?:\\s*,\\s*[${prefix.toLowerCase()}${prefix.toUpperCase()}]\\d+)*)\\s*\\]`,
      'g',
    );

  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(answerText)) !== null) {
    const rawIds = match[1].split(',').map((id) => id.trim().toLowerCase());

    for (const id of rawIds) {
      if (seenCitedIds.has(id)) {
        continue;
      }
      seenCitedIds.add(id);

      const evidence = pool.get(id);
      if (evidence) {
        citations.push(evidence);
      } else {
        invalidIds.push(id);
      }
    }
  }

  // Also catch generic bracketed references like [e99] or [ev99] that might have been cited with different spacing
  const genericBracketRegex = /\[\s*([a-zA-Z]+\d+)\s*\](?!\()/g;
  while ((match = genericBracketRegex.exec(answerText)) !== null) {
    const candidate = match[1].trim().toLowerCase();
    if (candidate.startsWith(prefix.toLowerCase()) && !seenCitedIds.has(candidate)) {
      seenCitedIds.add(candidate);
      const evidence = pool.get(candidate);
      if (evidence) {
        citations.push(evidence);
      } else {
        invalidIds.push(candidate);
      }
    }
  }

  return {
    isValid: invalidIds.length === 0,
    citations,
    invalidIds,
  };
}
