import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestScope } from '../common/interfaces/scope.interface';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceSource } from './evidence-source';
import { RawEvidenceCandidate, SourceQueryOptions } from './evidence.types';

interface ChunkQueryRow {
  id: string;
  content: string;
  page: number;
  heading: string | null;
  doc_id: string;
  doc_title: string;
  version_id: string;
  version_label: string;
  score: number;
}

@Injectable()
export class DocumentEvidenceSource implements EvidenceSource {
  readonly name = 'document';
  private readonly logger = new Logger(DocumentEvidenceSource.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Retrieves raw chunk passages using pgvector HNSW similarity search.
   *
   * Fully dynamic:
   * - Limit defaults dynamically to RETRIEVE_TOP_K or callers' limit override.
   * - Similarity floor defaults dynamically to SIMILARITY_FLOOR or callers' floor override.
   * - Hard multi-tenant boundary enforced via SQL Membership join and active workspaceId.
   * - Bare `<=>` operator leveraged for PostgreSQL chunk_embedding_hnsw index.
   */
  async query(
    question: string,
    queryVector: number[],
    scope: RequestScope,
    limit?: number,
    options?: SourceQueryOptions,
  ): Promise<RawEvidenceCandidate[]> {
    if (!queryVector || queryVector.length === 0) {
      return [];
    }

    const effectiveLimit =
      limit ??
      parseInt(this.config.get<string>('RETRIEVE_TOP_K', '3'), 10);

    const effectiveFloor =
      options?.similarityFloor ??
      parseFloat(this.config.get<string>('SIMILARITY_FLOOR', '0.55'));

    const vec = `[${queryVector.join(',')}]`;

    // The joins and WHERE clauses strictly enforce tenant permissions dynamically.
    const rows = await this.prisma.$queryRaw<ChunkQueryRow[]>`
      SELECT
        c.id,
        c.content,
        c.page,
        c.heading,
        d.id                                          AS doc_id,
        d.title                                       AS doc_title,
        v.id                                          AS version_id,
        v.label                                       AS version_label,
        (1 - (c.embedding <=> ${vec}::vector))::float AS score
      FROM "Chunk" c
      JOIN "Version"    v ON v.id = c."versionId"
      JOIN "Document"   d ON d.id = v."documentId"
      JOIN "Membership" m ON m."workspaceId" = d."workspaceId"
      WHERE m."userId"      = ${scope.userId}
        AND d."workspaceId" = ${scope.workspaceId}
        AND d.status        = 'READY'
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT ${effectiveLimit}
    `;

    // Apply dynamic SIMILARITY_FLOOR in TypeScript to preserve index usage in PostgreSQL
    const kept = rows.filter((r) => Number(r.score) >= effectiveFloor);

    this.logger.debug(
      `Retrieved ${rows.length} raw chunk(s) for query, ${kept.length} passed dynamic similarity floor (>= ${effectiveFloor})`,
    );

    return kept.map((r) => ({
      sourceId: r.id,
      documentId: r.doc_id,
      documentTitle: r.doc_title,
      versionId: r.version_id,
      versionLabel: r.version_label,
      pageNumber: r.page,
      heading: r.heading,
      content: r.content,
      score: Number(r.score),
    }));
  }

  /**
   * Dynamically retrieves all READY documents in the active workspace for abstention context.
   */
  async getReadyDocumentTitles(scope: RequestScope): Promise<string[]> {
    const docs = await this.prisma.document.findMany({
      where: {
        workspaceId: scope.workspaceId,
        status: 'READY',
        workspace: {
          members: {
            some: {
              userId: scope.userId,
            },
          },
        },
      },
      select: {
        title: true,
      },
    });

    return docs.map((d) => d.title);
  }
}
