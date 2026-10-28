import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}

@Injectable()
export class ModelProviderHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const baseUrl = process.env.LLM_BASE_URL ?? 'http://localhost:11434';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(baseUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      const isUp = res.status < 500;
      if (!isUp) {
        throw new Error(`Model provider returned HTTP ${res.status}`);
      }

      return this.getStatus(key, true, { url: baseUrl, status: res.status });
    } catch (error) {
      throw new HealthCheckError(
        'Model provider check failed',
        this.getStatus(key, false, {
          url: baseUrl,
          message: (error as Error).message,
        }),
      );
    }
  }
}
