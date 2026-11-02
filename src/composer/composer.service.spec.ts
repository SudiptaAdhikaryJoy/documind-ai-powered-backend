import { Test, TestingModule } from '@nestjs/testing';
import { RequestScope } from '../common/interfaces/scope.interface';
import { EvidencePool } from '../evidence/evidence-pool';
import { EvidenceService } from '../evidence/evidence.service';
import { RawEvidenceCandidate } from '../evidence/evidence.types';
import { LlmService } from '../llm/llm.service';
import { QueryLogService } from '../query-log/query-log.service';
import { ComposerService } from './composer.service';

describe('ComposerService', () => {
  let service: ComposerService;
  let evidenceService: EvidenceService;
  let llmService: LlmService;
  let queryLogService: QueryLogService;

  const mockScope: RequestScope = {
    userId: 'user-123',
    workspaceId: 'ws-456',
    role: 'MEMBER' as any,
  };

  const mockCandidate1: RawEvidenceCandidate = {
    sourceId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Payments Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 3,
    heading: 'Webhooks',
    content: 'Webhook requests include an idempotency key.',
    score: 0.88,
  };

  const mockCandidate2: RawEvidenceCandidate = {
    sourceId: 'chunk-2',
    documentId: 'doc-1',
    documentTitle: 'Payments Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 5,
    heading: 'Refunds',
    content: 'Refunds must be processed within 30 days.',
    score: 0.76,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComposerService,
        {
          provide: EvidenceService,
          useValue: {
            retrieveEvidence: jest.fn(),
            verifyCitations: jest.fn(),
          },
        },
        {
          provide: LlmService,
          useValue: {
            complete: jest.fn(),
          },
        },
        {
          provide: QueryLogService,
          useValue: {
            log: jest.fn().mockResolvedValue({ id: 'log-1' }),
          },
        },
      ],
    }).compile();

    service = module.get<ComposerService>(ComposerService);
    evidenceService = module.get<EvidenceService>(EvidenceService);
    llmService = module.get<LlmService>(LlmService);
    queryLogService = module.get<QueryLogService>(QueryLogService);
  });

  it('composes valid answer with citations and records telemetry when evidence is strong', async () => {
    const pool = new EvidencePool();
    const ev1 = pool.add(mockCandidate1); // e1
    const ev2 = pool.add(mockCandidate2); // e2

    jest.spyOn(evidenceService, 'retrieveEvidence').mockResolvedValueOnce({
      evidences: [ev1, ev2],
      pool,
      abstained: false,
      searchedDocumentTitles: ['Payments Architecture.pdf'],
    });

    jest.spyOn(llmService, 'complete').mockResolvedValueOnce({
      content: 'Webhooks require an idempotency key [e1] and refunds take 30 days [e2].',
      promptTokens: 150,
      outputTokens: 20,
      latencyMs: 700,
      model: 'qwen/qwen3.8-27b',
    });

    jest.spyOn(evidenceService, 'verifyCitations').mockReturnValueOnce({
      isValid: true,
      citations: [ev1, ev2],
      invalidIds: [],
    });

    const result = await service.composeAnswer(
      'What are webhook and refund policies?',
      mockScope,
    );

    expect(result.abstained).toBe(false);
    expect(result.answer).toContain('Webhooks require an idempotency key [e1]');
    expect(result.citations.length).toBe(2);
    expect(result.model).toBe('qwen/qwen3.8-27b');

    // Verify QueryLog was recorded with success
    expect(queryLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: mockScope.workspaceId,
        abstained: false,
        reason: null,
      }),
    );
  });

  it('triggers Gate 1 Abstention and completely skips LLM call when evidence is insufficient', async () => {
    const pool = new EvidencePool();

    jest.spyOn(evidenceService, 'retrieveEvidence').mockResolvedValueOnce({
      evidences: [],
      pool,
      abstained: true,
      reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
      searchedDocumentTitles: ['Payments Architecture.pdf'],
    });

    const result = await service.composeAnswer(
      'Unrelated quantum physics question',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('INSUFFICIENT_EVIDENCE_GATE_1');
    expect(result.answer).toContain('I do not have enough verified evidence');
    expect(llmService.complete).not.toHaveBeenCalled();

    // Verify telemetry logged
    expect(queryLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
      }),
    );
  });

  it('triggers Gate 2 Abstention when LLM returns INSUFFICIENT_EVIDENCE sentinel', async () => {
    const pool = new EvidencePool();
    pool.add(mockCandidate1);
    pool.add(mockCandidate2);

    jest.spyOn(evidenceService, 'retrieveEvidence').mockResolvedValueOnce({
      evidences: pool.getAll(),
      pool,
      abstained: false,
      searchedDocumentTitles: ['Payments Architecture.pdf'],
    });

    jest.spyOn(llmService, 'complete').mockResolvedValueOnce({
      content: 'INSUFFICIENT_EVIDENCE',
      promptTokens: 140,
      outputTokens: 4,
      latencyMs: 500,
      model: 'qwen/qwen3.8-27b',
    });

    const result = await service.composeAnswer(
      'Question missing specific details',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('INSUFFICIENT_EVIDENCE_GATE_2');
    expect(result.answer).toContain('I do not have enough verified evidence');
    expect(evidenceService.verifyCitations).not.toHaveBeenCalled();

    expect(queryLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_2',
      }),
    );
  });

  it('triggers Gate 2 Abstention when LLM cites hallucinated IDs not in the evidence pool', async () => {
    const pool = new EvidencePool();
    pool.add(mockCandidate1);
    pool.add(mockCandidate2);

    jest.spyOn(evidenceService, 'retrieveEvidence').mockResolvedValueOnce({
      evidences: pool.getAll(),
      pool,
      abstained: false,
      searchedDocumentTitles: ['Payments Architecture.pdf'],
    });

    jest.spyOn(llmService, 'complete').mockResolvedValueOnce({
      content: 'Payment terms are established in [e99].',
      promptTokens: 140,
      outputTokens: 10,
      latencyMs: 600,
      model: 'qwen/qwen3.8-27b',
    });

    jest.spyOn(evidenceService, 'verifyCitations').mockReturnValueOnce({
      isValid: false,
      citations: [],
      invalidIds: ['e99'],
    });

    const result = await service.composeAnswer(
      'What are the payment terms?',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('CITATION_MISMATCH_GATE_2');
    expect(result.answer).toContain(
      'The generated answer cited references not present in the retrieved documents.',
    );

    expect(queryLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        abstained: true,
        reason: 'CITATION_MISMATCH_GATE_2',
      }),
    );
  });

  it('passes dynamic options through to retrieval and LLM services', async () => {
    const pool = new EvidencePool();
    pool.add(mockCandidate1);
    pool.add(mockCandidate2);

    jest.spyOn(evidenceService, 'retrieveEvidence').mockResolvedValueOnce({
      evidences: pool.getAll(),
      pool,
      abstained: false,
      searchedDocumentTitles: ['Payments Architecture.pdf'],
    });

    jest.spyOn(llmService, 'complete').mockResolvedValueOnce({
      content: 'Answer content [e1].',
      promptTokens: 100,
      outputTokens: 10,
      latencyMs: 400,
      model: 'custom-model',
    });

    jest.spyOn(evidenceService, 'verifyCitations').mockReturnValueOnce({
      isValid: true,
      citations: [pool.get('e1')!],
      invalidIds: [],
    });

    await service.composeAnswer(
      'Question with dynamic options',
      mockScope,
      {
        retrieval: { similarityFloor: 0.7, topK: 5 },
        llm: { model: 'custom-model', temperature: 0.1 },
      },
    );

    expect(evidenceService.retrieveEvidence).toHaveBeenCalledWith(
      'Question with dynamic options',
      mockScope,
      { similarityFloor: 0.7, topK: 5 },
    );

    expect(llmService.complete).toHaveBeenCalledWith({
      messages: expect.any(Array),
      options: { model: 'custom-model', temperature: 0.1 },
    });
  });
});
