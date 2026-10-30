import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Status } from '@prisma/client';
import * as crypto from 'crypto';
import { RequestScope } from '../common/interfaces/scope.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkerService } from './chunker.service';
import {
  DocumentDetailDto,
  DocumentSummaryDto,
  UploadResponseDto,
} from './dto/document.dto';
import { ExtractorService } from './extractor.service';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: ExtractorService,
    private readonly chunker: ChunkerService,
  ) {}

  async uploadDocument(
    scope: RequestScope,
    file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    const type = this.extractor.validateAndClassify(file);
    const sha256 = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    const extraction = await this.extractor.extract(file.buffer, type);
    const chunks = this.chunker.chunkPages(file.originalname, extraction.pages);

    if (chunks.length === 0) {
      throw new BadRequestException(
        'No meaningful text content could be extracted from document',
      );
    }

    // Check if document already exists in this workspace
    const existingDoc = await this.prisma.document.findFirst({
      where: {
        workspaceId: scope.workspaceId,
        title: file.originalname,
      },
      include: {
        versions: true,
      },
    });

    if (existingDoc) {
      const duplicateVersion = existingDoc.versions.find(
        (v) => v.sha256 === sha256,
      );
      if (duplicateVersion) {
        return {
          documentId: existingDoc.id,
          versionId: duplicateVersion.id,
          title: existingDoc.title,
          status: existingDoc.status,
          pageCount: existingDoc.pageCount,
          chunkCount: chunks.length,
          message: 'Document with identical content already exists',
        };
      }

      // Add a new version to the existing document
      const versionLabel = `v${existingDoc.versions.length + 1}`;

      const createdVersion = await this.prisma.$transaction(async (tx) => {
        const version = await tx.version.create({
          data: {
            documentId: existingDoc.id,
            label: versionLabel,
            byteSize: file.buffer.length,
            sha256,
          },
        });

        await tx.chunk.createMany({
          data: chunks.map((c) => ({
            versionId: version.id,
            ordinal: c.ordinal,
            page: c.page,
            heading: c.heading,
            content: c.content,
            tokens: c.tokens,
          })),
        });

        await tx.document.update({
          where: { id: existingDoc.id },
          data: {
            status: Status.PENDING,
            pageCount: extraction.pageCount,
          },
        });

        return version;
      });

      return {
        documentId: existingDoc.id,
        versionId: createdVersion.id,
        title: existingDoc.title,
        status: Status.PENDING,
        pageCount: extraction.pageCount,
        chunkCount: chunks.length,
        message: 'New document version uploaded and queued for indexing',
      };
    }

    // Create a brand new document
    const created = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          workspaceId: scope.workspaceId,
          title: file.originalname,
          kind: type,
          status: Status.PENDING,
          pageCount: extraction.pageCount,
        },
      });

      const version = await tx.version.create({
        data: {
          documentId: document.id,
          label: 'v1',
          byteSize: file.buffer.length,
          sha256,
        },
      });

      await tx.chunk.createMany({
        data: chunks.map((c) => ({
          versionId: version.id,
          ordinal: c.ordinal,
          page: c.page,
          heading: c.heading,
          content: c.content,
          tokens: c.tokens,
        })),
      });

      return { document, version };
    });

    return {
      documentId: created.document.id,
      versionId: created.version.id,
      title: created.document.title,
      status: created.document.status,
      pageCount: created.document.pageCount,
      chunkCount: chunks.length,
      message: 'Document uploaded successfully and queued for indexing',
    };
  }

  async listDocuments(scope: RequestScope): Promise<DocumentSummaryDto[]> {
    const docs = await this.prisma.document.findMany({
      where: { workspaceId: scope.workspaceId },
      include: {
        versions: {
          include: {
            _count: { select: { chunks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return docs.map((doc) => {
      const latestVersion = doc.versions[0];
      return {
        id: doc.id,
        title: doc.title,
        type: doc.kind,
        status: doc.status,
        pageCount: doc.pageCount,
        chunkCount: latestVersion?._count.chunks ?? 0,
        byteSize: latestVersion?.byteSize ?? 0,
        createdAt: doc.createdAt,
      };
    });
  }

  async getDocument(
    scope: RequestScope,
    documentId: string,
  ): Promise<DocumentDetailDto> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        workspaceId: scope.workspaceId,
      },
      include: {
        versions: {
          include: {
            _count: { select: { chunks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!doc) {
      throw new NotFoundException('Document not found in this workspace');
    }

    const latestVersion = doc.versions[0];

    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      title: doc.title,
      type: doc.kind,
      status: doc.status,
      pageCount: doc.pageCount,
      chunkCount: latestVersion?._count.chunks ?? 0,
      versions: doc.versions.map((v) => ({
        label: v.label,
        byteSize: v.byteSize,
        sha256: v.sha256,
        createdAt: v.createdAt,
      })),
      createdAt: doc.createdAt,
    };
  }

  async deleteDocument(
    scope: RequestScope,
    documentId: string,
  ): Promise<{ success: boolean; message: string }> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        workspaceId: scope.workspaceId,
      },
    });

    if (!doc) {
      throw new NotFoundException('Document not found in this workspace');
    }

    await this.prisma.document.delete({
      where: { id: documentId },
    });

    return {
      success: true,
      message: `Document "${doc.title}" deleted successfully`,
    };
  }
}
