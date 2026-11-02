import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestScope } from '../common/interfaces/scope.interface';
import { EmbeddingService } from '../document/embedding.service';
import { verifyCitations, VerifyCitationsOptions } from './citation.verifier';
import { DocumentEvidenceSource } from './document-evidence.source';
import { EvidencePool } from './evidence-pool';
import {
  CitationVerificationResult,
  RetrievalOptions,
  RetrievalResult,
} from './evidence.types';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingService: EmbeddingService,
    private readonly documentEvidenceSource: DocumentEvidenceSource,
  ) {}

  /**
   * Primary dynamic retrieval and evidence pooling pipeline.
   *
   * All parameters (topK, similarityFloor, minPassages, idPrefix) are evaluated
   * dynamically per invocation from ConfigService or request options, supporting
   * runtime configuration sweeps and multi-tenant custom policies.
   */
  async retrieveEvidence(
    question: string,
    scope: RequestScope,
    options?: RetrievalOptions,
  ): Promise<RetrievalResult> {
    const topK =
      options?.topK ??
      parseInt(this.config.get<string>('RETRIEVE_TOP_K', '3'), 10);

    const similarityFloor =
      options?.similarityFloor ??
      parseFloat(this.config.get<string>('SIMILARITY_FLOOR', '0.55'));

    const minPassages =
      options?.minPassages ??
      parseInt(this.config.get<string>('MIN_PASSAGES_TO_ANSWER', '2'), 10);

    const pool = new EvidencePool({
      idPrefix: options?.idPrefix,
    });

    // Dynamically retrieve available READY documents in this workspace
    const readyDocs = await this.documentEvidenceSource.getReadyDocumentTitles(scope);
    for (const docTitle of readyDocs) {
      pool.recordSearchedDocument(docTitle);
    }

    if (readyDocs.length === 0) {
      this.logger.log(
        `Workspace ${scope.workspaceId} has 0 READY documents. Triggering Gate 1 abstention.`,
      );
      return {
        evidences: [],
        pool,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
        searchedDocumentTitles: [],
      };
    }

    // Embed the user's query into the vector space dynamically
    const queryVector = await this.embeddingService.embedQuery(question);

    // Retrieve similarity candidates from pgvector with dynamic parameters
    const candidates = await this.documentEvidenceSource.query(
      question,
      queryVector,
      scope,
      topK,
      { similarityFloor },
    );

    // Populate evidence pool (pool dynamically assigns e1, e2, ... and deduplicates)
    pool.addAll(candidates);

    // Gate 1 (Pre-LLM Abstention):
    // Evaluates dynamic minPassages threshold
    if (pool.size < minPassages) {
      this.logger.log(
        `Gate 1 Abstention triggered: question retrieved ${pool.size} passage(s) (threshold: ${minPassages}, floor: ${similarityFloor})`,
      );
      return {
        evidences: pool.getAll(),
        pool,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
        searchedDocumentTitles: pool.getSearchedDocumentTitles(),
      };
    }

    return {
      evidences: pool.getAll(),
      pool,
      abstained: false,
      searchedDocumentTitles: pool.getSearchedDocumentTitles(),
    };
  }

  /**
   * Deterministic citation verification dynamically bound to the evidence pool.
   */
  verifyCitations(
    answerText: string,
    pool: EvidencePool,
    options?: VerifyCitationsOptions,
  ): CitationVerificationResult {
    return verifyCitations(answerText, pool, options);
  }
}
