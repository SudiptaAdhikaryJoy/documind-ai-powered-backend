import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Scope } from '../common/decorators/scope.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { RequestScope } from '../common/interfaces/scope.interface';
import { QueryLogService } from '../query-log/query-log.service';
import { ComposerService } from './composer.service';
import {
  AskDto,
  AskQueryParamDto,
  AskResponseDto,
  PaginatedQueryLogsDto,
  QueryHistoryQueryDto,
  QueryLogDto,
  WorkspaceStatsResponseDto,
} from './dto/ask.dto';

@ApiTags('ask')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
@Controller('workspaces/:workspaceId')
export class AskController {
  constructor(
    private readonly composerService: ComposerService,
    private readonly queryLogService: QueryLogService,
  ) {}

  @ApiOperation({
    summary: 'Ask a question over workspace documents (JSON or SSE stream)',
    description:
      'Answers the question strictly grounded in verified retrieved passages. Citations are verified deterministically before answer delivery. If evidence is thin or invalid, abstains explicitly.',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiOkResponse({ type: AskResponseDto })
  @ApiForbiddenResponse({
    description:
      'Not a member of this workspace or monthly free-tier query quota reached',
  })
  @Roles(Role.OWNER, Role.MEMBER, Role.VIEWER)
  @HttpCode(HttpStatus.OK)
  @Post('ask')
  async ask(
    @Scope() scope: RequestScope,
    @Body() dto: AskDto,
    @Res() res: Response,
  ) {
    if (dto.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      try {
        for await (const event of this.composerService.streamAnswer(
          dto.question,
          scope,
          {
            retrieval: {
              topK: dto.topK,
              similarityFloor: dto.similarityFloor,
              minPassages: dto.minPassages,
            },
            llm: {
              model: dto.model,
              temperature: dto.temperature,
              maxTokens: dto.maxTokens,
              think: dto.think,
            },
            prompt: {
              maxSentences: dto.maxSentences,
            },
          },
        )) {
          res.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          );
        }
        res.end();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`,
        );
        res.end();
      }
      return;
    }

    const result = await this.composerService.composeAnswer(
      dto.question,
      scope,
      {
        retrieval: {
          topK: dto.topK,
          similarityFloor: dto.similarityFloor,
          minPassages: dto.minPassages,
        },
        llm: {
          model: dto.model,
          temperature: dto.temperature,
          maxTokens: dto.maxTokens,
          think: dto.think,
        },
        prompt: {
          maxSentences: dto.maxSentences,
        },
      },
    );

    return res.json({
      answer: result.answer,
      abstained: result.abstained,
      reason: result.reason ?? null,
      citations: result.citations,
      searchedDocuments: result.searchedDocuments,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      model: result.model,
    });
  }

  @ApiOperation({
    summary:
      'Server-Sent Events (SSE) streaming endpoint for browser EventSource and CLI',
    description:
      'Streams real-time events: evidence (retrieved pool), token (answer chunks), done (verified citations and stats), or abstained (when Gate 1 or Gate 2 triggers).',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @Roles(Role.OWNER, Role.MEMBER, Role.VIEWER)
  @Sse('ask')
  askStream(
    @Scope() scope: RequestScope,
    @Query() query: AskQueryParamDto,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          for await (const event of this.composerService.streamAnswer(
            query.question,
            scope,
            {
              retrieval: {
                topK: query.topK,
                similarityFloor: query.similarityFloor,
                minPassages: query.minPassages,
              },
              llm: {
                model: query.model,
                temperature: query.temperature,
                maxTokens: query.maxTokens,
              },
            },
          )) {
            subscriber.next({
              type: event.type,
              data: event.data,
            } as MessageEvent);
          }
          subscriber.complete();
        } catch (err: unknown) {
          subscriber.error(err);
        }
      })();
    });
  }

  @ApiOperation({
    summary: 'List paginated query execution logs and telemetry for workspace',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
  })
  @ApiOkResponse({ type: PaginatedQueryLogsDto })
  @Roles(Role.OWNER, Role.MEMBER, Role.VIEWER)
  @Get('queries')
  listQueries(
    @Scope() scope: RequestScope,
    @Query() query: QueryHistoryQueryDto,
  ): Promise<PaginatedQueryLogsDto> {
    return this.queryLogService.listWorkspaceLogsPaginated(
      scope.workspaceId,
      query.limit ?? 20,
      query.offset ?? 0,
    );
  }

  @ApiOperation({
    summary: 'Get workspace telemetry statistics (query volume, abstention rate, latency)',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
  })
  @ApiOkResponse({ type: WorkspaceStatsResponseDto })
  @Roles(Role.OWNER, Role.MEMBER, Role.VIEWER)
  @Get('queries/stats')
  getQueryStats(
    @Scope() scope: RequestScope,
  ): Promise<WorkspaceStatsResponseDto> {
    return this.queryLogService.getWorkspaceStats(scope.workspaceId);
  }

  @ApiOperation({
    summary: 'Get single query log details by ID',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
  })
  @ApiParam({
    name: 'queryId',
    description: 'Query Log UUID',
  })
  @ApiOkResponse({ type: QueryLogDto })
  @ApiNotFoundResponse({ description: 'Query log not found' })
  @Roles(Role.OWNER, Role.MEMBER, Role.VIEWER)
  @Get('queries/:queryId')
  async getQueryById(
    @Scope() scope: RequestScope,
    @Param('queryId') queryId: string,
  ): Promise<QueryLogDto> {
    const log = await this.queryLogService.getQueryLogById(
      scope.workspaceId,
      queryId,
    );
    if (!log) {
      throw new NotFoundException(`Query log with ID ${queryId} not found`);
    }
    return log;
  }
}
