import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface ChunkToEmbed {
  id: string;
  content: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly expectedDim: number;
  private readonly batchSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.config
      .get<string>('EMBED_BASE_URL', 'http://localhost:11434')
      .replace(/\/+$/, '');
    this.model = this.config.get<string>('EMBED_MODEL', 'nomic-embed-text');
    this.expectedDim = parseInt(
      this.config.get<string>('EMBED_DIM', '768'),
      10,
    );
    this.batchSize = parseInt(this.config.get<string>('EMBED_BATCH', '16'), 10);
  }

  async embedAndStoreChunks(chunks: ChunkToEmbed[]): Promise<void> {
    if (chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const slice = chunks.slice(i, i + this.batchSize);
      const texts = slice.map((c) => c.content);

      const embeddings = await this.generateEmbeddings(texts);

      if (embeddings.length !== slice.length) {
        throw new InternalServerErrorException(
          `Embedding count mismatch: expected ${slice.length}, got ${embeddings.length}`,
        );
      }

      // Store vectors into Postgres in a transaction
      await this.prisma.$transaction(async (tx) => {
        for (let j = 0; j < slice.length; j++) {
          const chunkId = slice[j].id;
          const vector = embeddings[j];

          if (vector.length !== this.expectedDim) {
            throw new InternalServerErrorException(
              `Embedding dimension mismatch: expected ${this.expectedDim}, got ${vector.length}`,
            );
          }

          const vectorString = `[${vector.join(',')}]`;
          await tx.$executeRawUnsafe(
            `UPDATE "Chunk" SET "embedding" = $1::vector WHERE "id" = $2`,
            vectorString,
            chunkId,
          );
        }
      });
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      // First attempt: Ollama /api/embed batch API
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { embeddings?: number[][] };
        if (data.embeddings && Array.isArray(data.embeddings)) {
          return data.embeddings;
        }
      }

      // Fallback: Individual /api/embeddings calls
      this.logger.warn(
        `Batch embed failed with status ${response.status}. Falling back to sequential /api/embeddings`,
      );

      const results: number[][] = [];
      for (const text of texts) {
        const singleRes = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: text,
          }),
        });

        if (!singleRes.ok) {
          const errText = await singleRes.text();
          throw new Error(`Embedding failed (${singleRes.status}): ${errText}`);
        }

        const data = (await singleRes.json()) as { embedding: number[] };
        results.push(data.embedding);
      }

      return results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Error generating embeddings: ${msg}`, stack);
      throw new InternalServerErrorException(
        `Failed to generate embeddings: ${msg}`,
      );
    }
  }
}
