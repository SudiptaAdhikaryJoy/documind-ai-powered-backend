import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { LlmModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueryLogService } from '../query-log/query-log.service';
import { ComposerService } from './composer.service';

@Module({
  imports: [EvidenceModule, LlmModule, PrismaModule],
  providers: [ComposerService, QueryLogService],
  exports: [ComposerService, QueryLogService],
})
export class ComposerModule {}
