import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { lastValueFrom, toArray } from 'rxjs';
import { RequestScope } from '../common/interfaces/scope.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLogService } from '../query-log/query-log.service';
import { AskController } from './ask.controller';
import { ComposerService } from './composer.service';
import { ComposedAnswer, SseStreamEvent } from './composer.types';

describe('AskController', () => {
  let controller: AskController;
  let composerService: ComposerService;
  let queryLogService: QueryLogService;

  const mockScope: RequestScope = {
    userId: 'user-123',
    workspaceId: 'ws-456',
    role: 'MEMBER' as any,
  };

  const mockComposedAnswer: ComposedAnswer = {
    answer: 'Refunds must be processed within 30 days [e1].',
    abstained: false,
    reason: undefined,
    citations: [
      {
        id: 'e1',
        sourceId: 'chunk-1',
        documentId: 'doc-1',
        documentTitle: 'Refund Policy.pdf',
        versionId: 'v-1',
        versionLabel: 'v1',
        pageNumber: 2,
        heading: 'Refund Window',
        content: 'Refunds must be processed within 30 days.',
        score: 0.91,
      },
    ],
    pool: {} as any,
    searchedDocuments: ['Refund Policy.pdf'],
    promptTokens: 250,
    outputTokens: 20,
    latencyMs: 780,
    model: 'qwen/qwen3.8-27b',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AskController],
      providers: [
        {
          provide: ComposerService,
          useValue: {
            composeAnswer: jest.fn().mockResolvedValue(mockComposedAnswer),
            streamAnswer: jest.fn(),
          },
        },
        {
          provide: QueryLogService,
          useValue: {
            listWorkspaceLogsPaginated: jest.fn().mockResolvedValue({
              items: [{ id: 'log-1', question: 'How do refunds work?' }],
              total: 1,
              limit: 20,
              offset: 0,
            }),
            getWorkspaceStats: jest.fn().mockResolvedValue({
              totalQueries: 50,
              abstainedQueries: 5,
              abstentionRate: '0.1000',
              avgLatencyMs: 650,
            }),
            getQueryLogById: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            membership: {
              findFirst: jest.fn(),
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AskController>(AskController);
    composerService = module.get<ComposerService>(ComposerService);
    queryLogService = module.get<QueryLogService>(QueryLogService);
  });

  describe('POST ask (JSON mode)', () => {
    it('returns structured answer with verified citations', async () => {
      const mockRes = {
        json: jest.fn(),
      } as any;

      await controller.ask(
        mockScope,
        { question: 'How do refunds work?', topK: 3, similarityFloor: 0.55 },
        mockRes,
      );

      expect(composerService.composeAnswer).toHaveBeenCalledWith(
        'How do refunds work?',
        mockScope,
        expect.objectContaining({
          retrieval: expect.objectContaining({
            topK: 3,
            similarityFloor: 0.55,
          }),
        }),
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        answer: 'Refunds must be processed within 30 days [e1].',
        abstained: false,
        reason: null,
        citations: mockComposedAnswer.citations,
        searchedDocuments: ['Refund Policy.pdf'],
        promptTokens: 250,
        outputTokens: 20,
        latencyMs: 780,
        model: 'qwen/qwen3.8-27b',
      });
    });

    it('forwards all dynamic options (model, temperature, maxTokens, think, minPassages, maxSentences) to ComposerService', async () => {
      const mockRes = { json: jest.fn() } as any;

      await controller.ask(
        mockScope,
        {
          question: 'What is the retry policy?',
          topK: 5,
          similarityFloor: 0.65,
          minPassages: 3,
          model: 'qwen3:4b',
          temperature: 0.2,
          maxTokens: 150,
          think: false,
          maxSentences: 2,
        },
        mockRes,
      );

      expect(composerService.composeAnswer).toHaveBeenCalledWith(
        'What is the retry policy?',
        mockScope,
        {
          retrieval: {
            topK: 5,
            similarityFloor: 0.65,
            minPassages: 3,
          },
          llm: {
            model: 'qwen3:4b',
            temperature: 0.2,
            maxTokens: 150,
            think: false,
          },
          prompt: {
            maxSentences: 2,
          },
        },
      );
    });

    it('returns abstention payload when Gate 1 triggers', async () => {
      jest.spyOn(composerService, 'composeAnswer').mockResolvedValueOnce({
        answer:
          'I do not have enough verified evidence in your documents to answer this question. (Searched: Refund Policy.pdf)',
        abstained: true,
        reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
        citations: [],
        pool: {} as any,
        searchedDocuments: ['Refund Policy.pdf'],
        promptTokens: 0,
        outputTokens: 0,
        latencyMs: 15,
        model: 'gate_1_heuristic',
      });

      const mockRes = {
        json: jest.fn(),
      } as any;

      await controller.ask(
        mockScope,
        { question: 'What is the quantum state?' },
        mockRes,
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          abstained: true,
          reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
          citations: [],
        }),
      );
    });
  });

  describe('POST ask (SSE stream mode)', () => {
    it('sets SSE headers and flushes stream events', async () => {
      async function* mockGenerator(): AsyncGenerator<SseStreamEvent> {
        yield {
          type: 'evidence',
          data: {
            searchedDocuments: ['Refund Policy.pdf'],
            pool: [],
          },
        };
        yield {
          type: 'token',
          data: { token: 'Refunds ' },
        };
        yield {
          type: 'done',
          data: {
            answer: 'Refunds are 30 days.',
            citations: [],
            promptTokens: 100,
            outputTokens: 10,
            latencyMs: 400,
            model: 'qwen',
          },
        };
      }

      jest
        .spyOn(composerService, 'streamAnswer')
        .mockReturnValue(mockGenerator());

      const writtenChunks: string[] = [];
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((chunk) => writtenChunks.push(chunk)),
        end: jest.fn(),
      } as any;

      await controller.ask(
        mockScope,
        { question: 'Refunds?', stream: true },
        mockRes,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Connection',
        'keep-alive',
      );
      expect(writtenChunks.some((c) => c.includes('event: evidence'))).toBe(
        true,
      );
      expect(writtenChunks.some((c) => c.includes('event: token'))).toBe(true);
      expect(writtenChunks.some((c) => c.includes('event: done'))).toBe(true);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('emits error event if generator throws', async () => {
      // eslint-disable-next-line require-yield
      async function* faultyGenerator(): AsyncGenerator<SseStreamEvent> {
        throw new Error('LLM provider unreachable');
      }

      jest
        .spyOn(composerService, 'streamAnswer')
        .mockReturnValue(faultyGenerator());

      const writtenChunks: string[] = [];
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((chunk) => writtenChunks.push(chunk)),
        end: jest.fn(),
      } as any;

      await controller.ask(
        mockScope,
        { question: 'Refunds?', stream: true },
        mockRes,
      );

      expect(writtenChunks.some((c) => c.includes('event: error'))).toBe(true);
      expect(
        writtenChunks.some((c) => c.includes('LLM provider unreachable')),
      ).toBe(true);
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('GET ask (Sse Observable)', () => {
    it('streams MessageEvents for EventSource clients', async () => {
      async function* mockGenerator(): AsyncGenerator<SseStreamEvent> {
        yield {
          type: 'evidence',
          data: {
            searchedDocuments: ['Refund Policy.pdf'],
            pool: [],
          },
        };
        yield {
          type: 'token',
          data: { token: 'Refunds ' },
        };
        yield {
          type: 'done',
          data: {
            answer: 'Refunds are 30 days.',
            citations: [],
            promptTokens: 100,
            outputTokens: 10,
            latencyMs: 400,
            model: 'qwen',
          },
        };
      }

      jest
        .spyOn(composerService, 'streamAnswer')
        .mockReturnValue(mockGenerator());

      const observable = controller.askStream(mockScope, {
        question: 'Refunds?',
      });
      const events = await lastValueFrom(observable.pipe(toArray()));

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('evidence');
      expect(events[1].type).toBe('token');
      expect(events[2].type).toBe('done');
    });
  });

  describe('Queries History & Stats', () => {
    it('returns paginated query history', async () => {
      const result = await controller.listQueries(mockScope, {
        limit: 10,
        offset: 5,
      });

      expect(queryLogService.listWorkspaceLogsPaginated).toHaveBeenCalledWith(
        'ws-456',
        10,
        5,
      );
      expect(result.total).toBe(1);
    });

    it('returns workspace telemetry stats', async () => {
      const stats = await controller.getQueryStats(mockScope);

      expect(queryLogService.getWorkspaceStats).toHaveBeenCalledWith('ws-456');
      expect(stats.totalQueries).toBe(50);
      expect(stats.abstentionRate).toBe('0.1000');
    });

    it('returns query log by ID', async () => {
      jest.spyOn(queryLogService, 'getQueryLogById').mockResolvedValueOnce({
        id: 'log-1',
        workspaceId: 'ws-456',
        question: 'How do refunds work?',
      } as any);

      const log = await controller.getQueryById(mockScope, 'log-1');

      expect(log.id).toBe('log-1');
      expect(queryLogService.getQueryLogById).toHaveBeenCalledWith(
        'ws-456',
        'log-1',
      );
    });

    it('throws NotFoundException when query log ID is not found', async () => {
      jest
        .spyOn(queryLogService, 'getQueryLogById')
        .mockResolvedValueOnce(null);

      await expect(
        controller.getQueryById(mockScope, 'nonexistent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
