import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

type DocumentWithLatestVersion = Prisma.DocumentGetPayload<{
  include: {
    versions: {
      orderBy: { createdAt: 'desc' };
      take: 1;
    };
  };
}>;

/**
 * Detects whether an error is caused by a database connection failure or network unreachable condition.
 */
export function isDatabaseConnectionError(err: unknown): boolean {
  if (!err) return false;

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P1000: Authentication failed
    // P1001: Can't reach database server
    // P1002: The database server was reached but timed out
    // P1008: Operations timed out
    // P1017: Server has closed the connection
    const connectionCodes = ['P1000', 'P1001', 'P1002', 'P1008', 'P1017'];
    if (connectionCodes.includes(err.code)) {
      return true;
    }
  }

  if (typeof err === 'object' && err !== null) {
    const errorObj = err as Record<string, unknown>;
    const code = typeof errorObj.code === 'string' ? errorObj.code : '';
    if (
      [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNRESET',
        'EPIPE',
        'EHOSTUNREACH',
      ].includes(code)
    ) {
      return true;
    }
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("can't reach database server") ||
      msg.includes('cant reach database server') ||
      msg.includes('connection pool timeout') ||
      msg.includes('server has closed the connection') ||
      msg.includes('connection terminated') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('econnreset')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a concise error message suitable for clean logging without massive stack traces.
 */
export function getDatabaseErrorMessage(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const lines = err.message.split('\n').map((l) => l.trim()).filter(Boolean);
    const relevant = lines.find(
      (l) =>
        l.toLowerCase().includes("can't reach database server") ||
        l.toLowerCase().includes('database server') ||
        l.toLowerCase().includes('timed out') ||
        l.toLowerCase().includes('connection'),
    );
    return relevant || `Prisma error ${err.code}`;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    const lines = err.message.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines[0] || 'Prisma initialization connection error';
  }

  if (err instanceof Error) {
    const firstLine = err.message.split('\n')[0].trim();
    return firstLine;
  }

  return String(err);
}

@Injectable()
export class IngestionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IngestionWorker.name);
  private readonly pollIntervalMs: number;
  private timerHandle: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isShuttingDown = false;

  private isDbConnected = true;
  private consecutiveDbErrors = 0;
  private currentBackoffMs: number;
  private interruptedDocIds = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.pollIntervalMs = parseInt(
      this.config.get<string>('WORKER_POLL_MS', '5000'),
      10,
    );
    this.currentBackoffMs = this.pollIntervalMs;
  }

  async onApplicationBootstrap() {
    // Reset stuck INDEXING or previously FAILED documents to PENDING on startup
    await this.recoverStuckDocuments();

    this.logger.log(
      `Ingestion worker started (polling every ${this.pollIntervalMs}ms)`,
    );

    // Run first poll after 1 second
    this.scheduleNext(1000);
  }

  onApplicationShutdown() {
    this.isShuttingDown = true;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    this.logger.log('Ingestion worker shut down cleanly');
  }

  private scheduleNext(delayMs: number): void {
    if (this.isShuttingDown) return;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
    }
    this.timerHandle = setTimeout(() => {
      void this.pollAndProcess();
    }, delayMs);
    this.timerHandle.unref();
  }

  async pollAndProcess(): Promise<void> {
    if (this.isProcessing || this.isShuttingDown) return;
    this.isProcessing = true;

    try {
      // Step 1: Query for pending documents
      let doc: DocumentWithLatestVersion | null = null;
      try {
        doc = await this.prisma.document.findFirst({
          where: { status: Status.PENDING },
          include: {
            versions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        // If previously disconnected, handle reconnection
        if (!this.isDbConnected) {
          await this.handleConnectionRestored();
        }
      } catch (pollErr: unknown) {
        this.handleDbError(pollErr, 'poll');
        return;
      }

      // Step 2: If no documents waiting, schedule next poll at normal interval
      if (!doc) {
        this.scheduleNext(this.pollIntervalMs);
        return;
      }

      // Step 3: Process the document
      await this.processDocument(doc);

      // Successfully processed; schedule next poll quickly to drain any pending queue
      this.scheduleNext(200);
    } catch (unexpectedErr: unknown) {
      const msg =
        unexpectedErr instanceof Error
          ? unexpectedErr.message
          : String(unexpectedErr);
      this.logger.error(`Unexpected worker error: ${msg}`);
      this.scheduleNext(this.pollIntervalMs);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processDocument(doc: DocumentWithLatestVersion): Promise<void> {
    this.logger.log(
      `Starting ingestion for document "${doc.title}" (${doc.id})`,
    );

    try {
      // Transition to INDEXING
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: Status.INDEXING },
      });

      const latestVersion = doc.versions[0];
      if (!latestVersion) {
        this.logger.warn(`Document ${doc.id} has no versions. Marking READY.`);
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { status: Status.READY },
        });
        return;
      }

      // Find chunks where embedding IS NULL
      const unembeddedChunks = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; heading: string | null; content: string }>
      >(
        `SELECT "id", "heading", "content" FROM "Chunk" WHERE "versionId" = $1 AND "embedding" IS NULL ORDER BY "ordinal" ASC`,
        latestVersion.id,
      );

      if (unembeddedChunks.length > 0) {
        this.logger.log(
          `Embedding ${unembeddedChunks.length} chunk(s) for "${doc.title}"`,
        );
        await this.embeddingService.embedAndStoreChunks(unembeddedChunks);
      }

      // Mark document as READY
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: Status.READY },
      });

      this.logger.log(
        `Document "${doc.title}" (${doc.id}) successfully indexed and READY`,
      );
    } catch (err: unknown) {
      if (isDatabaseConnectionError(err)) {
        this.logger.warn(
          `Database connection lost while processing document "${doc.title}" (${doc.id}). Document will be retried when connectivity is restored.`,
        );
        this.interruptedDocIds.add(doc.id);
        // Attempt to revert status to PENDING if connection allows
        try {
          await this.prisma.document.update({
            where: { id: doc.id },
            data: { status: Status.PENDING },
          });
          this.interruptedDocIds.delete(doc.id);
        } catch {
          // Keep in interruptedDocIds to be reset once connection is restored
        }
        this.handleDbError(err, 'processing');
        return;
      }

      // Genuine document processing error (corrupt file, bad embedding, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Document processing failed for "${doc.title}" (${doc.id}): ${msg}`,
        stack,
      );

      try {
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { status: Status.FAILED },
        });
      } catch (markErr: unknown) {
        const markMsg =
          markErr instanceof Error ? markErr.message : String(markErr);
        this.logger.error(`Failed to mark document as FAILED: ${markMsg}`);
      }
    }
  }

  private handleDbError(err: unknown, context: 'poll' | 'processing'): void {
    if (isDatabaseConnectionError(err)) {
      this.consecutiveDbErrors++;
      // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
      const factor = Math.min(this.consecutiveDbErrors, 4);
      this.currentBackoffMs = Math.min(
        this.pollIntervalMs * Math.pow(2, factor),
        60000,
      );

      const briefMsg = getDatabaseErrorMessage(err);

      if (this.isDbConnected) {
        this.isDbConnected = false;
        this.logger.warn(
          `Database server unreachable (${briefMsg}). Ingestion polling paused; retrying in ${Math.round(this.currentBackoffMs / 1000)}s...`,
        );
      } else if (this.consecutiveDbErrors % 5 === 0) {
        this.logger.warn(
          `Database still unreachable after ${this.consecutiveDbErrors} attempts (${briefMsg}). Retrying in ${Math.round(this.currentBackoffMs / 1000)}s...`,
        );
      }

      this.scheduleNext(this.currentBackoffMs);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Error during document ${context}: ${msg}`, stack);
      this.scheduleNext(this.pollIntervalMs);
    }
  }

  private async handleConnectionRestored(): Promise<void> {
    this.isDbConnected = true;
    this.consecutiveDbErrors = 0;
    this.currentBackoffMs = this.pollIntervalMs;
    this.logger.log(
      'Database connection restored. Ingestion worker resumed normal polling.',
    );

    // If documents were interrupted by a DB connection drop, recover them to PENDING
    if (this.interruptedDocIds.size > 0) {
      const ids = Array.from(this.interruptedDocIds);
      try {
        const res = await this.prisma.document.updateMany({
          where: { id: { in: ids }, status: Status.INDEXING },
          data: { status: Status.PENDING },
        });
        this.interruptedDocIds.clear();
        this.logger.log(
          `Recovered ${res.count} interrupted document(s) back to PENDING for re-indexing.`,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Could not reset interrupted documents on reconnect: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async recoverStuckDocuments(): Promise<void> {
    try {
      const reset = await this.prisma.document.updateMany({
        where: { status: { in: [Status.INDEXING, Status.FAILED] } },
        data: { status: Status.PENDING },
      });
      if (reset.count > 0) {
        this.logger.warn(
          `Self-healing: reset ${reset.count} document(s) from INDEXING/FAILED to PENDING`,
        );
      }
    } catch (err: unknown) {
      if (isDatabaseConnectionError(err)) {
        this.isDbConnected = false;
        this.logger.warn(
          `Database unreachable during bootstrap self-healing (${getDatabaseErrorMessage(err)}). Self-healing will run when connected.`,
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to reset stuck documents during bootstrap: ${msg}`,
        );
      }
    }
  }
}

