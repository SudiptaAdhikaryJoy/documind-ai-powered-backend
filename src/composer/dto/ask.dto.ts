import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AskDto {
  @ApiProperty({
    description: 'The natural language question to ask over the workspace documents',
    example: 'What is the payment timeout duration and retry policy?',
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({
    description: 'When true, response will be streamed using Server-Sent Events (SSE)',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of top-k passages to retrieve',
    default: 3,
    minimum: 1,
    maximum: 10,
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;

  @ApiPropertyOptional({
    description: 'Minimum cosine similarity floor (0.0 to 1.0)',
    default: 0.55,
    minimum: 0,
    maximum: 1,
    example: 0.55,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityFloor?: number;

  @ApiPropertyOptional({
    description: 'Minimum passages required to answer before Gate 1 abstains',
    default: 2,
    minimum: 1,
    maximum: 10,
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  minPassages?: number;

  @ApiPropertyOptional({
    description: 'Model identifier override (e.g. qwen/qwen3.8-27b, qwen3:4b)',
    example: 'qwen/qwen3.8-27b',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'Temperature override (0 for deterministic evaluations)',
    default: 0,
    minimum: 0,
    maximum: 2,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Maximum generation output tokens',
    default: 250,
    minimum: 1,
    maximum: 4096,
    example: 250,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: 'Reasoning model think flag override (false for factual extraction)',
    default: false,
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  think?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum answer sentence budget in prompt instruction',
    default: 4,
    minimum: 1,
    maximum: 20,
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxSentences?: number;
}

export class AskQueryParamDto {
  @ApiProperty({
    description: 'The natural language question to ask over workspace documents',
    example: 'What is the refund window?',
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({
    description: 'Maximum number of top-k passages to retrieve',
    default: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;

  @ApiPropertyOptional({
    description: 'Minimum cosine similarity floor (0.0 to 1.0)',
    default: 0.55,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityFloor?: number;

  @ApiPropertyOptional({
    description: 'Minimum passages required to answer before Gate 1 abstains',
    default: 2,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  minPassages?: number;

  @ApiPropertyOptional({
    description: 'Model identifier override (defaults to LLM_MODEL in .env)',
    example: 'qwen/qwen3.8-27b',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'Temperature override',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Maximum generation output tokens',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number;
}

export class CitationDto {
  @ApiProperty({ example: '[1]' })
  id: string;

  @ApiProperty({ example: 'chunk-uuid-123' })
  sourceId: string;

  @ApiProperty({ example: 'doc-uuid-456' })
  documentId: string;

  @ApiProperty({ example: 'Payments Architecture.pdf' })
  documentTitle: string;

  @ApiProperty({ example: 'v1' })
  versionLabel: string;

  @ApiProperty({ example: 4 })
  pageNumber: number;

  @ApiProperty({ example: 'Retry Policies', nullable: true })
  heading: string | null;

  @ApiProperty({ example: 'Payment retry requests must include idempotency keys...' })
  content: string;

  @ApiProperty({ example: 0.884 })
  score: number;
}

export class AskResponseDto {
  @ApiProperty({
    description: 'Composed answer with [id] citations, or explicit abstention message',
    example: 'Payment retry requests must include idempotency keys [1]. Refunds are processed in 30 days [2].',
  })
  answer: string;

  @ApiProperty({
    description: 'Whether the query was abstained due to Gate 1 (low evidence) or Gate 2 (citation mismatch)',
    example: false,
  })
  abstained: boolean;

  @ApiProperty({
    description: 'Reason for abstention, if applicable',
    enum: [
      'INSUFFICIENT_EVIDENCE_GATE_1',
      'INSUFFICIENT_EVIDENCE_GATE_2',
      'CITATION_MISMATCH_GATE_2',
    ],
    nullable: true,
    example: null,
  })
  reason: string | null;

  @ApiProperty({
    description: 'Verified citations mapped to page provenance',
    type: [CitationDto],
  })
  citations: CitationDto[];

  @ApiProperty({
    description: 'Titles of documents searched during this query',
    example: ['Payments Architecture.pdf', 'Refunds Guide.pdf'],
  })
  searchedDocuments: string[];

  @ApiProperty({ description: 'Prompt tokens consumed', example: 450 })
  promptTokens: number;

  @ApiProperty({ description: 'Output tokens generated', example: 65 })
  outputTokens: number;

  @ApiProperty({ description: 'Total query latency in milliseconds', example: 1240 })
  latencyMs: number;

  @ApiProperty({ description: 'Model identifier used', example: 'qwen/qwen3.8-27b' })
  model: string;
}

export class QueryHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Number of logs to return',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Offset for pagination',
    default: 0,
    minimum: 0,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class QueryLogDto {
  @ApiProperty({ example: 'log-uuid-123' })
  id: string;

  @ApiProperty({ example: 'ws-uuid-456' })
  workspaceId: string;

  @ApiProperty({ example: 'user-uuid-789' })
  userId: string;

  @ApiProperty({ example: 'What is the refund window?' })
  question: string;

  @ApiProperty({ example: false })
  abstained: boolean;

  @ApiProperty({ example: null, nullable: true })
  reason: string | null;

  @ApiProperty({ example: 'qwen/qwen3.8-27b' })
  model: string;

  @ApiProperty({ example: 340 })
  promptTok: number;

  @ApiProperty({ example: 45 })
  outputTok: number;

  @ApiProperty({ example: 980 })
  latencyMs: number;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedQueryLogsDto {
  @ApiProperty({ type: [QueryLogDto] })
  items: QueryLogDto[];

  @ApiProperty({ example: 120 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}

export class WorkspaceStatsResponseDto {
  @ApiProperty({ example: 120 })
  totalQueries: number;

  @ApiProperty({ example: 15 })
  abstainedQueries: number;

  @ApiProperty({ example: '0.1250' })
  abstentionRate: string;

  @ApiProperty({ example: 850 })
  avgLatencyMs: number;
}
