import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChunkerService } from './chunker.service';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { EmbeddingService } from './embedding.service';
import { ExtractorService } from './extractor.service';
import { IngestionWorker } from './ingestion.worker';

@Module({
  imports: [PrismaModule, AuthModule, WorkspaceModule],
  controllers: [DocumentController],
  providers: [
    ExtractorService,
    ChunkerService,
    EmbeddingService,
    DocumentService,
    IngestionWorker,
  ],
  exports: [DocumentService, EmbeddingService],
})
export class DocumentModule {}
