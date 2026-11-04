import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { HealthModule } from './health/health.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DocumentModule } from './document/document.module';
import { CommunicationModule } from './communication/communication.module';
import { EvidenceModule } from './evidence/evidence.module';
import { LlmModule } from './llm/llm.module';
import { ComposerModule } from './composer/composer.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommunicationModule,
    AuthModule,
    UserModule,
    WorkspaceModule,
    DocumentModule,
    EvidenceModule,
    LlmModule,
    ComposerModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
