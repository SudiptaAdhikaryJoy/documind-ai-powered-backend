import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RequestScope } from '../common/interfaces/scope.interface';
import { EmbeddingService } from '../document/embedding.service';
import { DocumentEvidenceSource } from './document-evidence.source';
import { EvidenceService } from './evidence.service';
import { RawEvidenceCandidate } from './evidence.types';

describe('EvidenceService', () => {
  let service: EvidenceService;
  let embeddingService: EmbeddingService;
  let documentSource: DocumentEvidenceSource;

  const mockScope: RequestScope = {
    userId: 'user-123',
    workspaceId: 'ws-456',
    role: 'MEMBER' as any,
  };

  const mockPassage1: RawEvidenceCandidate = {
    sourceId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 1,
    heading: 'Core Architecture',
    content: 'DocuMind uses NestJS with modular monolith architecture.',
    score: 0.82,
  };

  const mockPassage2: RawEvidenceCandidate = {
    sourceId: 'chunk-2',
    documentId: 'doc-1',
    documentTitle: 'Architecture.pdf',
    versionId: 'ver-1',
    versionLabel: 'v1',
    pageNumber: 2,
    heading: 'Database Layer',
    content: 'PostgreSQL with pgvector stores chunk embeddings with HNSW indexing.',
    score: 0.79,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const env: Record<string, string> = {
                RETRIEVE_TOP_K: '3',
                SIMILARITY_FLOOR: '0.55',
                MIN_PASSAGES_TO_ANSWER: '2',
              };
              return env[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: EmbeddingService,
          useValue: {
            embedQuery: jest.fn().mockResolvedValue(new Array(768).fill(0.05)),
          },
        },
        {
          provide: DocumentEvidenceSource,
          useValue: {
            query: jest.fn().mockResolvedValue([mockPassage1, mockPassage2]),
            getReadyDocumentTitles: jest
              .fn()
              .mockResolvedValue(['Architecture.pdf']),
          },
        },
      ],
    }).compile();

    service = module.get<EvidenceService>(EvidenceService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);
    documentSource = module.get<DocumentEvidenceSource>(DocumentEvidenceSource);
  });

  it('successfully retrieves evidence when 2+ passages pass the similarity floor', async () => {
    const result = await service.retrieveEvidence(
      'What architecture does DocuMind use?',
      mockScope,
    );

    expect(result.abstained).toBe(false);
    expect(result.evidences.length).toBe(2);
    expect(result.pool.size).toBe(2);
    expect(result.evidences[0].id).toBe('e1');
    expect(result.evidences[1].id).toBe('e2');
    expect(embeddingService.embedQuery).toHaveBeenCalledWith(
      'What architecture does DocuMind use?',
    );
    expect(documentSource.query).toHaveBeenCalledTimes(1);
    expect(result.searchedDocumentTitles).toContain('Architecture.pdf');
  });

  it('triggers Gate 1 Abstention when fewer than 2 passages meet the similarity floor', async () => {
    // Only 1 passage returned
    jest.spyOn(documentSource, 'query').mockResolvedValueOnce([mockPassage1]);

    const result = await service.retrieveEvidence(
      'Obscure question with thin evidence',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('INSUFFICIENT_EVIDENCE_GATE_1');
    expect(result.evidences.length).toBe(1);
    expect(result.pool.size).toBe(1);
    expect(result.searchedDocumentTitles).toContain('Architecture.pdf');
  });

  it('triggers Gate 1 Abstention when zero passages meet the similarity floor', async () => {
    jest.spyOn(documentSource, 'query').mockResolvedValueOnce([]);

    const result = await service.retrieveEvidence(
      'Completely unrelated topic',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('INSUFFICIENT_EVIDENCE_GATE_1');
    expect(result.evidences.length).toBe(0);
    expect(result.pool.size).toBe(0);
  });

  it('triggers Gate 1 Abstention immediately when workspace has no READY documents', async () => {
    jest.spyOn(documentSource, 'getReadyDocumentTitles').mockResolvedValueOnce([]);

    const result = await service.retrieveEvidence(
      'Any question on empty workspace',
      mockScope,
    );

    expect(result.abstained).toBe(true);
    expect(result.reason).toBe('INSUFFICIENT_EVIDENCE_GATE_1');
    expect(result.evidences).toEqual([]);
    expect(embeddingService.embedQuery).not.toHaveBeenCalled();
    expect(documentSource.query).not.toHaveBeenCalled();
  });

  it('verifies citations deterministically', async () => {
    const result = await service.retrieveEvidence(
      'Architecture inquiry',
      mockScope,
    );

    const verified = service.verifyCitations(
      'DocuMind uses NestJS [e1] and pgvector [e2].',
      result.pool,
    );

    expect(verified.isValid).toBe(true);
    expect(verified.citations.length).toBe(2);
    expect(verified.invalidIds).toEqual([]);
  });

  it('dynamically respects custom options (minPassages, idPrefix, similarityFloor)', async () => {
    // Only 1 passage returned
    jest.spyOn(documentSource, 'query').mockResolvedValueOnce([mockPassage1]);

    // Pass dynamic minPassages: 1 and custom idPrefix: 'p'
    const result = await service.retrieveEvidence(
      'Question with dynamic options',
      mockScope,
      {
        minPassages: 1,
        idPrefix: 'p',
        similarityFloor: 0.7,
        topK: 5,
      },
    );

    expect(result.abstained).toBe(false);
    expect(result.evidences.length).toBe(1);
    expect(result.evidences[0].id).toBe('p1');
    expect(documentSource.query).toHaveBeenCalledWith(
      'Question with dynamic options',
      expect.any(Array),
      mockScope,
      5,
      { similarityFloor: 0.7 },
    );
  });
});
