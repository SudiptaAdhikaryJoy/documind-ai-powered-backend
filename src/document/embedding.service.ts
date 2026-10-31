import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface ChunkToEmbed {
  id: string;
  heading?: string | null;
  content: string;
}

type EmbedProvider = 'transformers' | 'ollama' | 'openai' | 'auto';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly provider: EmbedProvider;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly hfModel: string;
  private readonly expectedDim: number;
  private readonly batchSize: number;

  private extractorPromise: Promise<any> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.provider = (
      this.config.get<string>('EMBED_PROVIDER', 'transformers') ||
      'transformers'
    ).toLowerCase() as EmbedProvider;
    this.baseUrl = this.config
      .get<string>('EMBED_BASE_URL', 'http://localhost:11434')
      .replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('EMBED_API_KEY');
    this.model = this.config.get<string>('EMBED_MODEL', 'nomic-embed-text');
    this.hfModel = this.config.get<string>(
      'EMBED_HF_MODEL',
      'Xenova/nomic-embed-text-v1',
    );
    this.expectedDim = parseInt(
      this.config.get<string>('EMBED_DIM', '768'),
      10,
    );
    this.batchSize = parseInt(this.config.get<string>('EMBED_BATCH', '16'), 10);
  }

  /**
   * Lazily initializes the in-process ONNX feature-extraction pipeline
   * for `Xenova/nomic-embed-text-v1` (768 dimensions, quantized).
   */
  private async getTransformersExtractor(): Promise<any> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        this.logger.log(
          `Initializing in-process embedding model "${this.hfModel}" (${this.expectedDim}-dim)...`,
        );
        // Dynamic ESM import compatible with CommonJS NestJS compilation
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const { pipeline } = await (Function(
          'return import("@huggingface/transformers")',
        )() as Promise<any>);
        const pipe = await pipeline('feature-extraction', this.hfModel, {
          dtype: 'q8',
        });
        this.logger.log(
          `In-process embedding model "${this.hfModel}" ready (${this.expectedDim}-dim)`,
        );
        return pipe;
      })().catch((err) => {
        this.extractorPromise = null;
        throw err;
      });
    }
    return this.extractorPromise;
  }

  async embedAndStoreChunks(chunks: ChunkToEmbed[]): Promise<void> {
    if (chunks.length === 0) return;

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const slice = chunks.slice(i, i + this.batchSize);
      // Prefix each chunk with its section heading before embedding (per architecture spec)
      const texts = slice.map((c) =>
        c.heading ? `${c.heading}\n${c.content}` : c.content,
      );

      const embeddings = await this.generateEmbeddings(texts, 'document');

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

          if (!vector.every((val) => Number.isFinite(val))) {
            throw new InternalServerErrorException(
              `Invalid non-finite float detected in embedding vector for chunk ${chunkId}`,
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

  /**
   * Embeds a single user question into the same 768-dim vector space for retrieval.
   */
  async embedQuery(question: string): Promise<number[]> {
    const vectors = await this.generateEmbeddings([question], 'query');
    return vectors[0];
  }

  async generateEmbeddings(
    texts: string[],
    taskType: 'document' | 'query' = 'document',
  ): Promise<number[][]> {
    const prefix =
      taskType === 'query' ? 'search_query: ' : 'search_document: ';

    // 1. Primary path: In-process @huggingface/transformers (Xenova/nomic-embed-text-v1)
    if (this.provider === 'transformers' || this.provider === 'auto') {
      try {
        const extractor = await this.getTransformersExtractor();
        const prefixedInputs = texts.map((t) =>
          t.startsWith('search_') ? t : `${prefix}${t}`,
        );
        const output = await extractor(prefixedInputs, {
          pooling: 'mean',
          normalize: true,
        });
        const list = output.tolist() as number[][];
        if (
          Array.isArray(list) &&
          list.length === texts.length &&
          list[0]?.length === this.expectedDim
        ) {
          return list;
        }
      } catch (hfErr: unknown) {
        const msg = hfErr instanceof Error ? hfErr.message : String(hfErr);
        this.logger.warn(
          `In-process transformers embedding unavailable (${msg}), attempting fallback provider...`,
        );
      }
    }

    // 2. Secondary path: OpenAI-compatible /v1/embeddings endpoint (if configured)
    if (this.provider === 'openai') {
      try {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`OpenAI embeddings HTTP ${res.status}: ${errText}`);
        }
        const body = (await res.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
        };
        return body.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`OpenAI embedding provider failed: ${msg}`);
        throw new InternalServerErrorException(
          `Failed to generate embeddings: ${msg}`,
        );
      }
    }

    // 3. Ollama /api/embed & /api/embeddings
    try {
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
      this.logger.warn(
        `External embedding server (${this.baseUrl}) unavailable (${msg}). Using deterministic ${this.expectedDim}-dim fallback.`,
      );
      return texts.map((text) =>
        this.generateLocalFallbackEmbedding(text, this.expectedDim),
      );
    }
  }

  /**
   * Offline deterministic L2-normalized 768-dim fallback if both ONNX model download
   * and external Ollama server are unreachable.
   */
  private generateLocalFallbackEmbedding(text: string, dim: number): number[] {
    const vec = new Float64Array(dim);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);

    if (tokens.length === 0) {
      vec[0] = 1;
      return Array.from(vec);
    }

    const features: string[] = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      features.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    for (const token of tokens) {
      for (let i = 0; i <= token.length - 3; i++) {
        features.push(`#${token.slice(i, i + 3)}`);
      }
    }

    for (const feat of features) {
      const digest = crypto.createHash('md5').update(feat).digest();
      const idx1 = digest.readUInt16LE(0) % dim;
      const sign1 = (digest[2] & 1) === 0 ? 1 : -1;
      const idx2 = digest.readUInt16LE(4) % dim;
      const sign2 = (digest[6] & 1) === 0 ? 1 : -1;

      vec[idx1] += sign1;
      vec[idx2] += sign2 * 0.5;
    }

    let normSq = 0;
    for (let i = 0; i < dim; i++) {
      normSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(normSq) || 1;
    const result = new Array<number>(dim);
    for (let i = 0; i < dim; i++) {
      result[i] = Number((vec[i] / norm).toFixed(6));
    }
    return result;
  }
}
