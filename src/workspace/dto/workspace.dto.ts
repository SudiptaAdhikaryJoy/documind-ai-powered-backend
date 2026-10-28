import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Plan, Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Platform Team', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;
}

export class InviteMemberDto {
  @ApiPropertyOptional({ example: 'sadia@company.com' })
  @ValidateIf((o: InviteMemberDto) => !o.phone || o.email !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '01712345678' })
  @ValidateIf((o: InviteMemberDto) => !o.email || o.phone !== undefined)
  @IsString()
  @MinLength(11)
  phone?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.MEMBER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: Role, example: Role.MEMBER })
  @IsEnum(Role)
  role: Role;
}

export class WorkspaceSummaryDto {
  @ApiProperty({ example: 'workspace-uuid' })
  id: string;

  @ApiProperty({ example: 'Platform Team' })
  name: string;

  @ApiProperty({ enum: Plan, example: Plan.FREE })
  plan: Plan;

  @ApiProperty({ enum: Role, example: Role.OWNER })
  role: Role;

  @ApiProperty()
  createdAt: Date;
}

export class WorkspaceDetailDto {
  @ApiProperty({ example: 'workspace-uuid' })
  id: string;

  @ApiProperty({ example: 'Platform Team' })
  name: string;

  @ApiProperty({ enum: Plan, example: Plan.FREE })
  plan: Plan;

  @ApiProperty({ example: 4 })
  memberCount: number;

  @ApiProperty({ example: 12 })
  documentCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class MemberItemDto {
  @ApiProperty({ example: 'membership-uuid' })
  id: string;

  @ApiProperty({ example: 'user-uuid' })
  userId: string;

  @ApiProperty({ example: 'Sadia Rahman' })
  name: string;

  @ApiProperty({ example: 'sadia@company.com' })
  email: string;

  @ApiProperty({ example: '01712345678' })
  phone: string;

  @ApiProperty({ enum: Role, example: Role.MEMBER })
  role: Role;

  @ApiProperty()
  joinedAt: Date;
}
