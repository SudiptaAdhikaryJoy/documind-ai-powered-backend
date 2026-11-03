import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateQueryLogEntry {
  workspaceId: string;
  userId: string;
  question: string;
  abstained: boolean;
  reason?: string | null;
  model: string;
  promptTok: number;
  outputTok: number;
  latencyMs: number;
}

@Injectable()
export class QueryLogService {
  private readonly logger = new Logger(QueryLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a query execution record to the QueryLog table.
   */
  async log(entry: CreateQueryLogEntry) {
    try {
      return await this.prisma.queryLog.create({
        data: {
          workspaceId: entry.workspaceId,
          userId: entry.userId,
          question: entry.question,
          abstained: entry.abstained,
          reason: entry.reason ?? null,
          model: entry.model,
          promptTok: entry.promptTok,
          outputTok: entry.outputTok,
          latencyMs: entry.latencyMs,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to persist QueryLog: ${msg}`);
      // Telemetry failure should not break the user's answer response
      return null;
    }
  }

  /**
   * Retrieves query history for a workspace.
   */
  async listWorkspaceLogs(workspaceId: string, limit: number = 50) {
    return this.prisma.queryLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Retrieves paginated query logs for a workspace.
   */
  async listWorkspaceLogsPaginated(
    workspaceId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.queryLog.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.queryLog.count({
        where: { workspaceId },
      }),
    ]);

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  /**
   * Retrieves a single query log by ID within a workspace.
   */
  async getQueryLogById(workspaceId: string, id: string) {
    return this.prisma.queryLog.findFirst({
      where: { id, workspaceId },
    });
  }

  /**
   * Counts the number of queries executed by a workspace during the current calendar month.
   */
  async countMonthlyQueries(workspaceId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.prisma.queryLog.count({
      where: {
        workspaceId,
        createdAt: { gte: startOfMonth },
      },
    });
  }

  /**
   * Retrieves telemetry statistics for a workspace.
   */
  async getWorkspaceStats(workspaceId: string) {
    const total = await this.prisma.queryLog.count({
      where: { workspaceId },
    });

    const abstainedCount = await this.prisma.queryLog.count({
      where: { workspaceId, abstained: true },
    });

    const logs = await this.prisma.queryLog.findMany({
      where: { workspaceId },
      select: { latencyMs: true, promptTok: true, outputTok: true },
      take: 200,
    });

    const avgLatency =
      logs.length > 0
        ? Math.round(
            logs.reduce((sum, l) => sum + l.latencyMs, 0) / logs.length,
          )
        : 0;

    return {
      totalQueries: total,
      abstainedQueries: abstainedCount,
      abstentionRate: total > 0 ? (abstainedCount / total).toFixed(4) : '0',
      avgLatencyMs: avgLatency,
    };
  }
}
