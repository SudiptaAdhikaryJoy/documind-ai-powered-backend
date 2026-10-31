import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class IngestionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IngestionWorker.name);
  private readonly pollIntervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.pollIntervalMs = parseInt(
      this.config.get<string>('WORKER_POLL_MS', '5000'),
      10,
    );
  }

  async onApplicationBootstrap() {
    // Reset stuck INDEXING or previously FAILED documents to PENDING on startup
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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to reset stuck documents during bootstrap: ${msg}`,
      );
    }

    // Start background polling loop
    this.intervalHandle = setInterval(() => {
      void this.pollAndProcess();
    }, this.pollIntervalMs);
    this.intervalHandle.unref();

    this.logger.log(
      `Ingestion worker started (polling every ${this.pollIntervalMs}ms)`,
    );

    // Run first poll after 1 second
    const initialTimeout = setTimeout(() => {
      void this.pollAndProcess();
    }, 1000);
    initialTimeout.unref();
  }

  onApplicationShutdown() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('Ingestion worker shut down cleanly');
    }
  }

  async pollAndProcess(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    let currentDocId: string | null = null;

    try {
      const doc = await this.prisma.document.findFirst({
        where: { status: Status.PENDING },
        include: {
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!doc) {
        this.isProcessing = false;
        return;
      }

      currentDocId = doc.id;
      this.logger.log(
        `Starting ingestion for document "${doc.title}" (${doc.id})`,
      );

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
        this.isProcessing = false;
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
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Error processing pending document: ${msg}`, stack);
      // If we were processing a doc, mark it FAILED
      if (currentDocId) {
        try {
          await this.prisma.document.update({
            where: { id: currentDocId },
            data: { status: Status.FAILED },
          });
        } catch (markErr: unknown) {
          const markMsg =
            markErr instanceof Error ? markErr.message : String(markErr);
          this.logger.error(`Failed to mark document as FAILED: ${markMsg}`);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
