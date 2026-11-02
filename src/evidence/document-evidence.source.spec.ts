import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RequestScope } from '../common/interfaces/scope.interface';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentEvidenceSource } from './document-evidence.source';

describe('DocumentEvidenceSource', () => {
  let source: DocumentEvidenceSource;
  let prisma: PrismaService;

  const mockScope: RequestScope = {
    userId: 'user-123',
    workspaceId: 'ws-456',
    role: 'MEMBER' as any,
  };

  const mockDbRows = [
    {
      id: 'chunk-1',
      content: 'High similarity content',
      page: 1,
      heading: 'Introduction',
      doc_id: 'doc-1',
      doc_title: 'API Guide.pdf',
      version_id: 'ver-1',
      version_label: 'v1',
      score: 0.88,
    },
    {
      id: 'chunk-2',
      content: 'Medium similarity content',
      page: 2,
      heading: 'Details',
      doc_id: 'doc-1',
      doc_title: 'API Guide.pdf',
      version_id: 'ver-1',
      version_label: 'v1',
      score: 0.62,
    },
    {
      id: 'chunk-3',
      content: 'Low similarity content below floor',
      page: 3,
      heading: 'Appendix',
      doc_id: 'doc-2',
      doc_title: 'Old Guide.pdf',
      version_id: 'ver-2',
      version_label: 'v1',
      score: 0.45, // Below SIMILARITY_FLOOR (0.55)
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentEvidenceSource,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue(mockDbRows),
            document: {
              findMany: jest
                .fn()
                .mockResolvedValue([
                  { title: 'API Guide.pdf' },
                  { title: 'Runbook.pdf' },
                ]),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const env: Record<string, string> = {
                RETRIEVE_TOP_K: '3',
                SIMILARITY_FLOOR: '0.55',
              };
              return env[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    source = module.get<DocumentEvidenceSource>(DocumentEvidenceSource);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('queries pgvector and filters out chunks below similarity floor (0.55)', async () => {
    const dummyVector = new Array(768).fill(0.01);
    const results = await source.query(
      'How does auth work?',
      dummyVector,
      mockScope,
      3,
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // 3 rows returned by DB, but chunk-3 has score 0.45 < 0.55
    expect(results.length).toBe(2);
    expect(results[0].sourceId).toBe('chunk-1');
    expect(results[0].score).toBe(0.88);
    expect(results[1].sourceId).toBe('chunk-2');
    expect(results[1].score).toBe(0.62);
  });

  it('returns empty array if query vector is empty', async () => {
    const results = await source.query('Empty query', [], mockScope, 3);
    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('retrieves READY document titles for the active workspace', async () => {
    const titles = await source.getReadyDocumentTitles(mockScope);
    expect(titles).toEqual(['API Guide.pdf', 'Runbook.pdf']);
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: mockScope.workspaceId,
        status: 'READY',
        workspace: {
          members: {
            some: {
              userId: mockScope.userId,
            },
          },
        },
      },
      select: {
        title: true,
      },
    });
  });

  it('dynamically respects custom similarity floor overrides per query', async () => {
    const dummyVector = new Array(768).fill(0.01);
    // Lower threshold to 0.40 so chunk-3 (0.45) is included
    const results = await source.query(
      'Custom floor query',
      dummyVector,
      mockScope,
      10,
      { similarityFloor: 0.4 },
    );

    expect(results.length).toBe(3);
    expect(results[2].sourceId).toBe('chunk-3');
  });
});
