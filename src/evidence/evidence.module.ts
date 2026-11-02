import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentEvidenceSource } from './document-evidence.source';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [PrismaModule, DocumentModule],
  providers: [DocumentEvidenceSource, EvidenceService],
  exports: [EvidenceService, DocumentEvidenceSource],
})
export class EvidenceModule {}
