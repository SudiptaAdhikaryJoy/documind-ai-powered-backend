import { EvidencePool } from '../evidence/evidence-pool';
import { Evidence, RetrievalOptions } from '../evidence/evidence.types';
import { LlmCompletionOptions } from '../llm/llm.types';
import { PromptBuilderOptions } from './prompt.builder';

export type AbstentionReason =
  | 'INSUFFICIENT_EVIDENCE_GATE_1'
  | 'INSUFFICIENT_EVIDENCE_GATE_2'
  | 'CITATION_MISMATCH_GATE_2';

export interface ComposedAnswer {
  /**
   * The composed answer text, or the explicit abstention message.
   */
  answer: string;

  /**
   * Indicates whether the engine abstained (Gate 1 or Gate 2).
   */
  abstained: boolean;

  /**
   * Explains why the engine abstained, if applicable.
   */
  reason?: AbstentionReason;

  /**
   * Verified evidence citations resolved back to their page provenance.
   */
  citations: Evidence[];

  /**
   * The EvidencePool containing all retrieved passages for this query.
   */
  pool: EvidencePool;

  /**
   * Titles of documents searched during this query.
   */
  searchedDocuments: string[];

  /**
   * Prompt tokens consumed.
   */
  promptTokens: number;

  /**
   * Output tokens generated.
   */
  outputTokens: number;

  /**
   * Total latency in milliseconds (retrieval + LLM).
   */
  latencyMs: number;

  /**
   * Model identifier used for composition.
   */
  model: string;
}

export interface ComposerOptions {
  retrieval?: RetrievalOptions;
  llm?: LlmCompletionOptions;
  prompt?: PromptBuilderOptions;
}

export type SseEventType =
  | 'evidence'
  | 'token'
  | 'abstained'
  | 'done'
  | 'error';

export interface SseEvidenceEvent {
  type: 'evidence';
  data: {
    searchedDocuments: string[];
    pool: Array<{
      id: string;
      sourceId: string;
      documentId: string;
      documentTitle: string;
      versionLabel: string;
      pageNumber: number;
      heading: string | null;
      score: number;
      content: string;
    }>;
  };
}

export interface SseTokenEvent {
  type: 'token';
  data: {
    token: string;
  };
}

export interface SseAbstainedEvent {
  type: 'abstained';
  data: {
    abstained: true;
    reason: AbstentionReason;
    message: string;
    searchedDocuments: string[];
  };
}

export interface SseDoneEvent {
  type: 'done';
  data: {
    answer: string;
    citations: Evidence[];
    promptTokens: number;
    outputTokens: number;
    latencyMs: number;
    model: string;
  };
}

export interface SseErrorEvent {
  type: 'error';
  data: {
    message: string;
  };
}

export type SseStreamEvent =
  | SseEvidenceEvent
  | SseTokenEvent
  | SseAbstainedEvent
  | SseDoneEvent
  | SseErrorEvent;

