import { Evidence, RawEvidenceCandidate } from './evidence.types';

export interface EvidencePoolOptions {
  idPrefix?: string;
}

/**
 * EvidencePool is the sole authority for minting evidence IDs (e.g. e1, e2, ...).
 * It deduplicates passages, encapsulates retrieval context, and renders XML-fenced
 * passage blocks for LLM consumption per the grounded-prompts specification.
 */
export class EvidencePool {
  private readonly idPrefix: string;
  private readonly evidences: Evidence[] = [];
  private readonly evidenceMap = new Map<string, Evidence>();
  private readonly seenSourceIds = new Set<string>();
  private readonly searchedDocuments = new Set<string>();

  constructor(options?: EvidencePoolOptions) {
    this.idPrefix = options?.idPrefix ?? 'e';
  }

  /**
   * Adds a candidate passage to the pool.
   * If the passage has already been added (deduplicated by sourceId), the existing
   * evidence entry is returned without minting a new ID.
   */
  add(candidate: RawEvidenceCandidate): Evidence {
    this.searchedDocuments.add(candidate.documentTitle);

    if (this.seenSourceIds.has(candidate.sourceId)) {
      const existing = this.evidences.find((e) => e.sourceId === candidate.sourceId);
      if (existing) {
        return existing;
      }
    }

    const nextIndex = this.evidences.length + 1;
    const id = `${this.idPrefix}${nextIndex}`;

    const evidence: Evidence = {
      id,
      sourceId: candidate.sourceId,
      documentId: candidate.documentId,
      documentTitle: candidate.documentTitle,
      versionId: candidate.versionId,
      versionLabel: candidate.versionLabel,
      pageNumber: candidate.pageNumber,
      heading: candidate.heading,
      content: candidate.content,
      score: candidate.score,
    };

    this.seenSourceIds.add(candidate.sourceId);
    this.evidences.push(evidence);
    this.evidenceMap.set(id, evidence);

    return evidence;
  }

  /**
   * Batch adds candidate passages to the pool.
   */
  addAll(candidates: RawEvidenceCandidate[]): Evidence[] {
    return candidates.map((c) => this.add(c));
  }

  /**
   * Records a document title as having been searched, even if no chunks passed the similarity floor.
   */
  recordSearchedDocument(documentTitle: string): void {
    if (documentTitle) {
      this.searchedDocuments.add(documentTitle);
    }
  }

  /**
   * Looks up an Evidence record by its assigned ID (e.g. "e1").
   */
  get(id: string): Evidence | undefined {
    return this.evidenceMap.get(id);
  }

  /**
   * Returns true if the pool contains the given ID.
   */
  has(id: string): boolean {
    return this.evidenceMap.has(id);
  }

  /**
   * Returns all evidence records in order of addition.
   */
  getAll(): Evidence[] {
    return [...this.evidences];
  }

  /**
   * Number of unique passages currently in the pool.
   */
  get size(): number {
    return this.evidences.length;
  }

  /**
   * Returns all unique document titles that were searched or added to the pool.
   */
  getSearchedDocumentTitles(): string[] {
    return Array.from(this.searchedDocuments);
  }

  /**
   * The prefix used by this pool for minted IDs (e.g. "e").
   */
  getIdPrefix(): string {
    return this.idPrefix;
  }

  /**
   * Renders the evidence passages enclosed in XML tags for prompt grounding.
   * Document text is treated strictly as untrusted data.
   */
  toPromptPassages(): string {
    if (this.evidences.length === 0) {
      return '<passages>\n</passages>';
    }

    const lines: string[] = ['<passages>'];

    for (const ev of this.evidences) {
      const headingAttr = ev.heading
        ? ` heading="${this.escapeXmlAttribute(ev.heading)}"`
        : '';
      const docAttr = this.escapeXmlAttribute(ev.documentTitle);

      lines.push(
        `<passage id="${ev.id}" doc="${docAttr}" page="${ev.pageNumber}"${headingAttr}>`,
      );
      lines.push(ev.content);
      lines.push('</passage>');
    }

    lines.push('</passages>');
    return lines.join('\n');
  }

  private escapeXmlAttribute(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
