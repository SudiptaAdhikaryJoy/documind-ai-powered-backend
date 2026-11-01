import { ConfigService } from '@nestjs/config';
import { Prisma, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import {
  getDatabaseErrorMessage,
  IngestionWorker,
  isDatabaseConnectionError,
} from './ingestion.worker';

describe('IngestionWorker - Database Error Handling', () => {
  let worker: IngestionWorker;
  let mockPrisma: any;
  let mockEmbeddingService: any;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockConfig = {
      get: jest.fn().mockImplementation((key: string, def?: string) => {
        if (key === 'WORKER_POLL_MS') return '5000';
        return def;
      }),
    };

    mockPrisma = {
      document: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };

    mockEmbeddingService = {
      embedAndStoreChunks: jest.fn().mockResolvedValue(undefined),
    };

    worker = new IngestionWorker(
      mockConfig as ConfigService,
      mockPrisma as PrismaService,
      mockEmbeddingService as EmbeddingService,
    );
  });

  afterEach(() => {
    worker.onApplicationShutdown();
    jest.useRealTimers();
  });

  describe('isDatabaseConnectionError', () => {
    it('should detect PrismaClientKnownRequestError with P1001 (can not reach server)', () => {
      const err = new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server at `pg-documind:28744`",
        {
          code: 'P1001',
          clientVersion: '6.0.0',
        },
      );
      expect(isDatabaseConnectionError(err)).toBe(true);
    });

    it('should detect PrismaClientKnownRequestError with P1002 (timeout) and P1017 (connection closed)', () => {
      const errTimeout = new Prisma.PrismaClientKnownRequestError('Timeout', {
        code: 'P1002',
        clientVersion: '6.0.0',
      });
      const errClosed = new Prisma.PrismaClientKnownRequestError(
        'Server closed',
        {
          code: 'P1017',
          clientVersion: '6.0.0',
        },
      );
      expect(isDatabaseConnectionError(errTimeout)).toBe(true);
      expect(isDatabaseConnectionError(errClosed)).toBe(true);
    });

    it('should detect PrismaClientInitializationError', () => {
      const err = new Prisma.PrismaClientInitializationError(
        "Can't reach database server",
        '6.0.0',
      );
      expect(isDatabaseConnectionError(err)).toBe(true);
    });

    it('should detect network error codes (ECONNREFUSED, ETIMEDOUT)', () => {
      const connRefused = Object.assign(new Error('Connection failed'), {
        code: 'ECONNREFUSED',
      });
      const timedOut = Object.assign(new Error('Connection timed out'), {
        code: 'ETIMEDOUT',
      });
      expect(isDatabaseConnectionError(connRefused)).toBe(true);
      expect(isDatabaseConnectionError(timedOut)).toBe(true);
    });

    it('should detect connection error text in generic Error', () => {
      const err = new Error(
        "Can't reach database server at pg-documind-documind-ai.k.aivencloud.com:28744",
      );
      expect(isDatabaseConnectionError(err)).toBe(true);
    });

    it('should return false for application / non-DB errors', () => {
      const appErr = new Error('Embedding API returned 429 Too Many Requests');
      expect(isDatabaseConnectionError(appErr)).toBe(false);
      expect(isDatabaseConnectionError(null)).toBe(false);
      expect(isDatabaseConnectionError(undefined)).toBe(false);
    });
  });

  describe('getDatabaseErrorMessage', () => {
    it('should extract the concise message from PrismaClientKnownRequestError', () => {
      const multilineMsg = `
Invalid \`this.prisma.document.findFirst()\` invocation in
/src/document/ingestion.worker.ts:82:46

Can't reach database server at \`pg-documind:28744\`

Please make sure your database server is running.
      `.trim();

      const err = new Prisma.PrismaClientKnownRequestError(multilineMsg, {
        code: 'P1001',
        clientVersion: '6.0.0',
      });

      const clean = getDatabaseErrorMessage(err);
      expect(clean).toContain("Can't reach database server");
      expect(clean).not.toContain('/src/document/ingestion.worker.ts:82:46');
    });
  });

  describe('pollAndProcess database error handling', () => {
    it('should handle P1001 gracefully during polling without throwing or logging error stack', async () => {
      const warnSpy = jest.spyOn((worker as any).logger, 'warn');
      const errorSpy = jest.spyOn((worker as any).logger, 'error');

      const p1001 = new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server at `pg-documind:28744`",
        {
          code: 'P1001',
          clientVersion: '6.0.0',
        },
      );
      mockPrisma.document.findFirst.mockRejectedValue(p1001);

      await worker.pollAndProcess();

      // Should log a warning, NOT an error
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database server unreachable'),
      );
      expect(errorSpy).not.toHaveBeenCalled();

      // Backoff should have increased from 5000ms
      expect((worker as any).isDbConnected).toBe(false);
      expect((worker as any).consecutiveDbErrors).toBe(1);
    });

    it('should notify when connection is restored after a previous failure', async () => {
      const logSpy = jest.spyOn((worker as any).logger, 'log');

      // First poll fails with P1001
      const p1001 = new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server at `pg-documind:28744`",
        { code: 'P1001', clientVersion: '6.0.0' },
      );
      mockPrisma.document.findFirst.mockRejectedValueOnce(p1001);
      await worker.pollAndProcess();
      expect((worker as any).isDbConnected).toBe(false);

      // Second poll succeeds with no document found
      mockPrisma.document.findFirst.mockResolvedValueOnce(null);
      await worker.pollAndProcess();

      expect((worker as any).isDbConnected).toBe(true);
      expect((worker as any).consecutiveDbErrors).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database connection restored'),
      );
    });

    it('should NOT mark document as FAILED when database connection drops mid-ingestion', async () => {
      const warnSpy = jest.spyOn((worker as any).logger, 'warn');

      const mockDoc = {
        id: 'doc-123',
        title: 'Architecture Overview.pdf',
        status: Status.PENDING,
        versions: [{ id: 'ver-1' }],
      };

      // findFirst succeeds
      mockPrisma.document.findFirst.mockResolvedValueOnce(mockDoc);

      // update to INDEXING throws P1001
      const p1001 = new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server",
        { code: 'P1001', clientVersion: '6.0.0' },
      );
      mockPrisma.document.update.mockRejectedValue(p1001);

      await worker.pollAndProcess();

      // Should log warning that DB connection was lost during processing
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database connection lost while processing document'),
      );

      // Should NOT have marked document as FAILED
      expect(mockPrisma.document.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: Status.FAILED },
        }),
      );

      // Document ID should be in interrupted set for automatic recovery
      expect((worker as any).interruptedDocIds.has('doc-123')).toBe(true);
    });

    it('should mark document as FAILED when a non-database error occurs (e.g. embedding failure)', async () => {
      const errorSpy = jest.spyOn((worker as any).logger, 'error');

      const mockDoc = {
        id: 'doc-456',
        title: 'Corrupted.pdf',
        status: Status.PENDING,
        versions: [{ id: 'ver-1' }],
      };

      mockPrisma.document.findFirst.mockResolvedValueOnce(mockDoc);
      mockPrisma.document.update.mockResolvedValueOnce({
        ...mockDoc,
        status: Status.INDEXING,
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { id: 'chunk-1', heading: null, content: 'test content' },
      ]);
      mockEmbeddingService.embedAndStoreChunks.mockRejectedValueOnce(
        new Error('HuggingFace model tensor dimension mismatch'),
      );

      await worker.pollAndProcess();

      // Should log processing failure error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Document processing failed for "Corrupted.pdf"'),
        expect.any(String),
      );

      // Should have marked document as FAILED
      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-456' },
        data: { status: Status.FAILED },
      });
    });
  });
});
