import { ApiProperty } from '@nestjs/swagger';
import { Status } from '@prisma/client';

export class DocumentSummaryDto {
  @ApiProperty({ example: 'b5674384-9c86-4f6c-8ab5-257a31b4028a' })
  id: string;

  @ApiProperty({ example: 'Architecture_Design.pdf' })
  title: string;

  @ApiProperty({ example: 'pdf' })
  type: string;

  @ApiProperty({ enum: Status, example: Status.READY })
  status: Status;

  @ApiProperty({ example: 12 })
  pageCount: number;

  @ApiProperty({ example: 45 })
  chunkCount: number;

  @ApiProperty({ example: 1048576 })
  byteSize: number;

  @ApiProperty()
  createdAt: Date;
}

export class VersionSummaryDto {
  @ApiProperty({ example: 'v1' })
  label: string;

  @ApiProperty({ example: 1048576 })
  byteSize: number;

  @ApiProperty({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  sha256: string;

  @ApiProperty()
  createdAt: Date;
}

export class DocumentDetailDto {
  @ApiProperty({ example: 'b5674384-9c86-4f6c-8ab5-257a31b4028a' })
  id: string;

  @ApiProperty({ example: '358733f0-bb5f-407e-a960-b2cb704d481f' })
  workspaceId: string;

  @ApiProperty({ example: 'Architecture_Design.pdf' })
  title: string;

  @ApiProperty({ example: 'pdf' })
  type: string;

  @ApiProperty({ enum: Status, example: Status.READY })
  status: Status;

  @ApiProperty({ example: 12 })
  pageCount: number;

  @ApiProperty({ example: 45 })
  chunkCount: number;

  @ApiProperty({ type: [VersionSummaryDto] })
  versions: VersionSummaryDto[];

  @ApiProperty()
  createdAt: Date;
}

export class UploadResponseDto {
  @ApiProperty({ example: 'b5674384-9c86-4f6c-8ab5-257a31b4028a' })
  documentId: string;

  @ApiProperty({ example: 'c1234567-89ab-cdef-0123-456789abcdef' })
  versionId: string;

  @ApiProperty({ example: 'Architecture_Design.pdf' })
  title: string;

  @ApiProperty({ enum: Status, example: Status.PENDING })
  status: Status;

  @ApiProperty({ example: 12 })
  pageCount: number;

  @ApiProperty({ example: 45 })
  chunkCount: number;

  @ApiProperty({
    example: 'Document uploaded successfully and queued for indexing',
  })
  message: string;
}
