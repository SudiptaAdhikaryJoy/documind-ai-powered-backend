import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import {
  ModelProviderHealthIndicator,
  PrismaHealthIndicator,
} from './health.indicators';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, ModelProviderHealthIndicator],
})
export class HealthModule {}
