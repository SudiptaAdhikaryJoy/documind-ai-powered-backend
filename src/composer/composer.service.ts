import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan } from '@prisma/client';
import { RequestScope } from '../common/interfaces/scope.interface';
import { EvidenceService } from '../evidence/evidence.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLogService } from '../query-log/query-log.service';
import {
  AbstentionReason,
  ComposedAnswer,
  ComposerOptions,
  SseStreamEvent,
} from './composer.types';
import { PromptBuilder } from './prompt.builder';

@Injectable()
export class ComposerService {
  private readonly logger = new Logger(ComposerService.name);
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly llmService: LlmService,
    private readonly queryLogService: QueryLogService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Enforces monthly query quotas for workspaces on Plan.FREE.
   * Dynamically resolves quota threshold per invocation from ConfigService.
   */
  async checkPlanLimits(workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    });

    if (workspace && workspace.plan === Plan.FREE) {
      const freeMaxQuestions = parseInt(
        this.config.get<string>('FREE_MAX_QUESTIONS_PER_MONTH', '100'),
        10,
      );
      const monthQueries =
        await this.queryLogService.countMonthlyQueries(workspaceId);
      if (monthQueries >= freeMaxQuestions) {
        throw new ForbiddenException(
          `Free tier query limit reached (${freeMaxQuestions} questions/month). Upgrade to Team tier for unlimited queries.`,
        );
      }
    }
  }

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

    // 0. Plan Limits Quota Check
    await this.checkPlanLimits(scope.workspaceId);

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

  /**
   * Real-time Server-Sent Events (SSE) Question Answering Stream:
   * 1. Quota check.
   * 2. Evidence retrieval.
   * 3. Gate 1 check: emits abstained if low confidence.
   * 4. Emits evidence pool with page provenance.
   * 5. Prompts LLM and validates citations deterministically.
   * 6. Gate 2 check: emits abstained if invalid citations or INSUFFICIENT_EVIDENCE sentinel.
   * 7. Emits answer tokens and final done event.
   */
  async *streamAnswer(
    question: string,
    scope: RequestScope,
    options?: ComposerOptions,
  ): AsyncGenerator<SseStreamEvent> {
    const startTime = Date.now();

    // 0. Plan Limits Quota Check
    await this.checkPlanLimits(scope.workspaceId);

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

      yield {
        type: 'abstained',
        data: {
          abstained: true,
          reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
          message: answer,
          searchedDocuments: searchedDocs,
        },
      };
      return;
    }

    // 3. Emit Retrieved Evidence Pool with Page Provenance
    yield {
      type: 'evidence',
      data: {
        searchedDocuments: searchedDocs,
        pool: retrieval.pool.getAll().map((e) => ({
          id: e.id,
          sourceId: e.sourceId,
          documentId: e.documentId,
          documentTitle: e.documentTitle,
          versionLabel: e.versionLabel,
          pageNumber: e.pageNumber,
          heading: e.heading,
          score: e.score,
          content: e.content,
        })),
      },
    };

    // 4. Assemble Grounded Messages (Prompt Fencing)
    const messages = PromptBuilder.buildMessages(
      question,
      retrieval.pool,
      options?.prompt,
    );

    // 5. LLM Completion Call
    const llmRes = await this.llmService.complete({
      messages,
      options: options?.llm,
    });

    const totalLatencyMs = Date.now() - startTime;
    const trimmedContent = llmRes.content.trim();

    // 6. Gate 2 Check A: Model explicitly stated INSUFFICIENT_EVIDENCE
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

      yield {
        type: 'abstained',
        data: {
          abstained: true,
          reason: 'INSUFFICIENT_EVIDENCE_GATE_2',
          message: answer,
          searchedDocuments: searchedDocs,
        },
      };
      return;
    }

    // 7. Gate 2 Check B: Deterministic Citation Verification
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

      yield {
        type: 'abstained',
        data: {
          abstained: true,
          reason: 'CITATION_MISMATCH_GATE_2',
          message: answer,
          searchedDocuments: searchedDocs,
        },
      };
      return;
    }

    // 8. Gate 2 Passed: Stream verified tokens
    const tokens = trimmedContent.match(/\S+\s*/g) || [trimmedContent];
    for (const token of tokens) {
      yield {
        type: 'token',
        data: { token },
      };
    }

    // 9. Persist Query Log & Emit Done
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

    yield {
      type: 'done',
      data: {
        answer: trimmedContent,
        citations: verification.citations,
        promptTokens: llmRes.promptTokens,
        outputTokens: llmRes.outputTokens,
        latencyMs: totalLatencyMs,
        model: llmRes.model,
      },
    };
  }
}

