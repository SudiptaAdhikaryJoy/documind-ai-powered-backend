import { EvidencePool } from './evidence-pool';

export interface Evidence {
  /**
   * Monotonically assigned identifier, e.g. "e1", "e2".
   * Assigned exclusively by EvidencePool.
   */
  id: string;

  /**
   * Underlying Chunk UUID in PostgreSQL.
   */
  sourceId: string;

  /**
   * Document UUID.
   */
  documentId: string;

  /**
   * Sanitized document title (e.g. "Architecture Overview.pdf").
   */
  documentTitle: string;

  /**
   * Version UUID.
   */
  versionId: string;

  /**
   * Version label (e.g. "v1", "v2").
   */
  versionLabel: string;

  /**
   * 1-indexed page number in the original document.
   */
  pageNumber: number;

  /**
   * Section or Markdown heading, if present.
   */
  heading: string | null;

  /**
   * Text passage content of the chunk.
   */
  content: string;

  /**
   * Cosine similarity score (1 - distance), normalized in range [0, 1].
   */
  score: number;
}

/**
 * Raw candidate passage retrieved from an EvidenceSource before entering the pool.
 */
export interface RawEvidenceCandidate {
  sourceId: string;
  documentId: string;
  documentTitle: string;
  versionId: string;
  versionLabel: string;
  pageNumber: number;
  heading: string | null;
  content: string;
  score: number;
}

export interface SourceQueryOptions {
  limit?: number;
  similarityFloor?: number;
}

export interface RetrievalOptions {
  topK?: number;
  similarityFloor?: number;
  minPassages?: number;
  idPrefix?: string;
}

export interface RetrievalResult {
  evidences: Evidence[];
  pool: EvidencePool;
  abstained: boolean;
  reason?: string;
  searchedDocumentTitles: string[];
}

export interface CitationVerificationResult {
  isValid: boolean;
  citations: Evidence[];
  invalidIds: string[];
}
