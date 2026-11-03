import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLogService } from './query-log.service';

describe('QueryLogService', () => {
  let service: QueryLogService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryLogService,
        {
          provide: PrismaService,
          useValue: {
            queryLog: {
              create: jest.fn().mockResolvedValue({ id: 'log-1' }),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(10),
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueryLogService>(QueryLogService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('persists query log entry to Prisma QueryLog', async () => {
    await service.log({
      workspaceId: 'ws-123',
      userId: 'user-456',
      question: 'How do webhooks work?',
      abstained: false,
      reason: null,
      model: 'qwen/qwen3.8-27b',
      promptTok: 150,
      outputTok: 25,
      latencyMs: 850,
    });

    expect(prisma.queryLog.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-123',
        userId: 'user-456',
        question: 'How do webhooks work?',
        abstained: false,
        reason: null,
        model: 'qwen/qwen3.8-27b',
        promptTok: 150,
        outputTok: 25,
        latencyMs: 850,
      },
    });
  });

  it('handles database write failure gracefully without throwing', async () => {
    jest
      .spyOn(prisma.queryLog, 'create')
      .mockRejectedValueOnce(new Error('DB connection closed'));

    const result = await service.log({
      workspaceId: 'ws-123',
      userId: 'user-456',
      question: 'Test question',
      abstained: true,
      reason: 'INSUFFICIENT_EVIDENCE_GATE_1',
      model: 'gate_1',
      promptTok: 0,
      outputTok: 0,
      latencyMs: 12,
    });

    expect(result).toBeNull();
  });

  it('lists workspace logs ordered by creation date', async () => {
    await service.listWorkspaceLogs('ws-123', 20);

    expect(prisma.queryLog.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-123' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  it('computes workspace query statistics', async () => {
    jest.spyOn(prisma.queryLog, 'count').mockResolvedValueOnce(10); // total
    jest.spyOn(prisma.queryLog, 'count').mockResolvedValueOnce(3); // abstained
    jest.spyOn(prisma.queryLog, 'findMany').mockResolvedValueOnce([
      { latencyMs: 500 },
      { latencyMs: 700 },
    ] as any);

    const stats = await service.getWorkspaceStats('ws-123');

    expect(stats.totalQueries).toBe(10);
    expect(stats.abstainedQueries).toBe(3);
    expect(stats.abstentionRate).toBe('0.3000');
    expect(stats.avgLatencyMs).toBe(600);
  });

  it('retrieves paginated query logs with total count', async () => {
    const mockLogs = [{ id: 'log-1' }, { id: 'log-2' }];
    jest.spyOn(prisma.queryLog, 'findMany').mockResolvedValueOnce(mockLogs as any);
    jest.spyOn(prisma.queryLog, 'count').mockResolvedValueOnce(50);

    const result = await service.listWorkspaceLogsPaginated('ws-123', 10, 20);

    expect(prisma.queryLog.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-123' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      skip: 20,
    });
    expect(prisma.queryLog.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-123' },
    });
    expect(result).toEqual({
      items: mockLogs,
      total: 50,
      limit: 10,
      offset: 20,
    });
  });

  it('retrieves a single query log by ID', async () => {
    (prisma.queryLog as any).findFirst = jest.fn().mockResolvedValueOnce({ id: 'log-1', workspaceId: 'ws-123' });

    const result = await service.getQueryLogById('ws-123', 'log-1');

    expect((prisma.queryLog as any).findFirst).toHaveBeenCalledWith({
      where: { id: 'log-1', workspaceId: 'ws-123' },
    });
    expect(result).toEqual({ id: 'log-1', workspaceId: 'ws-123' });
  });

  it('counts queries for current month', async () => {
    jest.spyOn(prisma.queryLog, 'count').mockResolvedValueOnce(42);

    const count = await service.countMonthlyQueries('ws-123');

    expect(count).toBe(42);
    expect(prisma.queryLog.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-123',
        createdAt: { gte: expect.any(Date) },
      },
    });
  });
});
