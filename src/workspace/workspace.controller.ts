import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Scope } from '../common/decorators/scope.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { RequestScope } from '../common/interfaces/scope.interface';
import { JwtUserPayload } from '../auth/jwt.strategy';
import {
  CreateWorkspaceDto,
  InviteMemberDto,
  MemberItemDto,
  UpdateMemberRoleDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @ApiOperation({
    summary: 'List all workspaces the authenticated user belongs to',
  })
  @ApiOkResponse({ type: [WorkspaceSummaryDto] })
  @Get()
  listWorkspaces(@CurrentUser() user: JwtUserPayload) {
    return this.workspaceService.listUserWorkspaces(user.userId);
  }

  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiBody({ type: CreateWorkspaceDto })
  @ApiCreatedResponse({ type: WorkspaceSummaryDto })
  @Post()
  createWorkspace(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspaceService.createWorkspace(user.userId, dto);
  }

  @ApiOperation({ summary: 'Get workspace details' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiOkResponse({ type: WorkspaceDetailDto })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  @UseGuards(WorkspaceGuard)
  @Get(':workspaceId')
  getWorkspace(@Scope() scope: RequestScope) {
    return this.workspaceService.getWorkspace(scope);
  }

  @ApiOperation({ summary: 'List all members in the workspace' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiOkResponse({ type: [MemberItemDto] })
  @ApiForbiddenResponse({ description: 'Not a member of this workspace' })
  @UseGuards(WorkspaceGuard)
  @Get(':workspaceId/members')
  getMembers(@Scope() scope: RequestScope) {
    return this.workspaceService.getMembers(scope);
  }

  @ApiOperation({
    summary: 'Invite a registered user to the workspace (OWNER only)',
  })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiBody({ type: InviteMemberDto })
  @ApiCreatedResponse({ type: MemberItemDto })
  @ApiForbiddenResponse({ description: 'Requires OWNER role or non-member' })
  @ApiConflictResponse({ description: 'User already in workspace' })
  @ApiNotFoundResponse({ description: 'Target user not found' })
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(Role.OWNER)
  @Post(':workspaceId/members/invite')
  inviteMember(@Scope() scope: RequestScope, @Body() dto: InviteMemberDto) {
    return this.workspaceService.inviteMember(scope, dto);
  }

  @ApiOperation({ summary: 'Update a member role (OWNER only)' })
  @ApiParam({
    name: 'workspaceId',
    description: 'Workspace UUID',
    example: '358733f0-bb5f-407e-a960-b2cb704d481f',
  })
  @ApiParam({
    name: 'userId',
    description: 'Member User UUID to update',
  })
  @ApiBody({ type: UpdateMemberRoleDto })
  @ApiOkResponse({ type: MemberItemDto })
  @ApiForbiddenResponse({ description: 'Requires OWNER role or non-member' })
  @ApiNotFoundResponse({ description: 'Target member not found' })
  @UseGuards(WorkspaceGuard, RolesGuard)
  @Roles(Role.OWNER)
  @Patch(':workspaceId/members/:userId')
  updateMemberRole(
    @Scope() scope: RequestScope,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.workspaceService.updateMemberRole(scope, targetUserId, dto);
  }
}
