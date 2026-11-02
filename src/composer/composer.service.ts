import { Injectable, Logger } from '@nestjs/common';
import { RequestScope } from '../common/interfaces/scope.interface';
import { EvidenceService } from '../evidence/evidence.service';
import { LlmService } from '../llm/llm.service';
import { QueryLogService } from '../query-log/query-log.service';
import {
  AbstentionReason,
  ComposedAnswer,
  ComposerOptions,
} from './composer.types';
import { PromptBuilder } from './prompt.builder';

@Injectable()
export class ComposerService {
  private readonly logger = new Logger(ComposerService.name);

  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly llmService: LlmService,
    private readonly queryLogService: QueryLogService,
  ) {}

  /**
   * Complete Question Answering Pipeline:
   * 1. Vector retrieval with tenant isolation & pgvector HNSW search.
   * 2. Gate 1 Pre-LLM Abstention check (skip LLM on low confidence).
   * 3. Prompt assembly with untrusted data fencing.
   * 4. LLM completion with deterministic settings (temp=0, think=false).
   * 5. Gate 2 Post-LLM Abstention check (INSUFFICIENT_EVIDENCE sentinel & citation validation).
   * 6. Telemetry persistence to QueryLog.
   */
  async composeAnswer(
    question: string,
    scope: RequestScope,
    options?: ComposerOptions,
  ): Promise<ComposedAnswer> {
    const startTime = Date.now();

    // 1. Evidence Retrieval
    const retrieval = await this.evidenceService.retrieveEvidence(
      question,
      scope,
      options?.retrieval,
    );

    const searchedDocs = retrieval.searchedDocumentTitles;
    const docListSummary =
      searchedDocs.length > 0 ? searchedDocs.join(', ') : 'no indexed documents';

    // 2. Gate 1 Pre-LLM Abstention Check
    if (retrieval.abstained) {
      const latencyMs = Date.now() - startTime;
      const answer = `I do not have enough verified evidence in your documents to answer this question. (Searched: ${docListSummary})`;

      await this.queryLogService.log({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        question,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
        model: 'gate_1_heuristic',
        promptTok: 0,
        outputTok: 0,
        latencyMs,
      });

      return {
        answer,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
        citations: [],
        pool: retrieval.pool,
        searchedDocuments: searchedDocs,
        promptTokens: 0,
        outputTokens: 0,
        latencyMs,
        model: 'gate_1_heuristic',
      };
    }

    // 3. Assemble Grounded Messages (Prompt Fencing)
    const messages = PromptBuilder.buildMessages(
      question,
      retrieval.pool,
      options?.prompt,
    );

    // 4. LLM Completion Call
    const llmRes = await this.llmService.complete({
      messages,
      options: options?.llm,
    });

    const totalLatencyMs = Date.now() - startTime;
    const trimmedContent = llmRes.content.trim();

    // 5. Gate 2 Check A: Model explicitly stated INSUFFICIENT_EVIDENCE
    if (
      trimmedContent === 'INSUFFICIENT_EVIDENCE' ||
      trimmedContent.startsWith('INSUFFICIENT_EVIDENCE')
    ) {
      this.logger.log(
        `Gate 2 triggered: LLM replied with INSUFFICIENT_EVIDENCE sentinel`,
      );
      const answer = `I do not have enough verified evidence in your documents to answer this question. (Searched: ${docListSummary})`;

      await this.queryLogService.log({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        question,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_2',
        model: llmRes.model,
        promptTok: llmRes.promptTokens,
        outputTok: llmRes.outputTokens,
        latencyMs: totalLatencyMs,
      });

      return {
        answer,
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_2',
        citations: [],
        pool: retrieval.pool,
        searchedDocuments: searchedDocs,
        promptTokens: llmRes.promptTokens,
        outputTokens: llmRes.outputTokens,
        latencyMs: totalLatencyMs,
        model: llmRes.model,
      };
    }

    // 5. Gate 2 Check B: Deterministic Citation Verification
    const verification = this.evidenceService.verifyCitations(
      trimmedContent,
      retrieval.pool,
    );

    if (!verification.isValid) {
      this.logger.warn(
        `Gate 2 triggered: Hallucinated citation IDs detected: ${verification.invalidIds.join(', ')}`,
      );
      const answer = `The generated answer cited references not present in the retrieved documents. Abstaining from answering. (Searched: ${docListSummary})`;

      await this.queryLogService.log({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        question,
        abstained: true,
        reason: 'CITATION_MISMATCH_GATE_2',
        model: llmRes.model,
        promptTok: llmRes.promptTokens,
        outputTok: llmRes.outputTokens,
        latencyMs: totalLatencyMs,
      });

      return {
        answer,
        abstained: true,
        reason: 'CITATION_MISMATCH_GATE_2',
        citations: [],
        pool: retrieval.pool,
        searchedDocuments: searchedDocs,
        promptTokens: llmRes.promptTokens,
        outputTokens: llmRes.outputTokens,
        latencyMs: totalLatencyMs,
        model: llmRes.model,
      };
    }

    // 6. Success: Valid answer with page provenance citations
    await this.queryLogService.log({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      question,
      abstained: false,
      reason: null,
      model: llmRes.model,
      promptTok: llmRes.promptTokens,
      outputTok: llmRes.outputTokens,
      latencyMs: totalLatencyMs,
    });

    return {
      answer: trimmedContent,
      abstained: false,
      citations: verification.citations,
      pool: retrieval.pool,
      searchedDocuments: searchedDocs,
      promptTokens: llmRes.promptTokens,
      outputTokens: llmRes.outputTokens,
      latencyMs: totalLatencyMs,
      model: llmRes.model,
    };
  }
}
