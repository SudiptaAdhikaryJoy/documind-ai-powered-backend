import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Scope } from '../common/decorators/scope.decorator';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { RequestScope } from '../common/interfaces/scope.interface';
import { DocumentService } from './document.service';
import {
  DocumentDetailDto,
  DocumentSummaryDto,
  UploadResponseDto,
} from './dto/document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspaces/:workspaceId/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @ApiOperation({
    summary: 'Upload a document (PDF, Markdown, Plain Text) to the workspace',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, Markdown, or Plain Text)',
        },
      },
      required: ['file'],
    },
  })
  @ApiAcceptedResponse({
    description: 'Document accepted and queued for background indexing',
    type: UploadResponseDto,
  })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Scope() scope: RequestScope,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentService.uploadDocument(scope, file);
  }

  @ApiOperation({ summary: 'List all documents in the workspace' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiOkResponse({ type: [DocumentSummaryDto] })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @Get()
  listDocuments(@Scope() scope: RequestScope) {
    return this.documentService.listDocuments(scope);
  }

  @ApiOperation({ summary: 'Get details and indexing status of a document' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiParam({
    name: 'documentId',
    description: 'Document UUID',
  })
  @ApiOkResponse({ type: DocumentDetailDto })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @Get(':documentId')
  getDocument(
    @Scope() scope: RequestScope,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.getDocument(scope, documentId);
  }

  @ApiOperation({ summary: 'Delete a document and all its chunks/vectors' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiParam({
    name: 'documentId',
    description: 'Document UUID',
  })
  @ApiOkResponse({ description: 'Document successfully deleted' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @Delete(':documentId')
  deleteDocument(
    @Scope() scope: RequestScope,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.deleteDocument(scope, documentId);
  }
}
