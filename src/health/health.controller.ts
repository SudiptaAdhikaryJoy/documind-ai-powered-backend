import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import {
  ModelProviderHealthIndicator,
  PrismaHealthIndicator,
} from './health.indicators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly modelIndicator: ModelProviderHealthIndicator,
  ) {}

  @ApiOperation({
    summary: 'Check health of PostgreSQL database and the model provider',
  })
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.modelIndicator.isHealthy('model_provider'),
    ]);
  }
}
