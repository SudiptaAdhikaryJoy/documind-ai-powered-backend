import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Plan, Role } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class WorkspaceMembershipDto {
  @ApiProperty({ example: '358733f0-bb5f-407e-a960-b2cb704d481f' })
  workspaceId: string;

  @ApiProperty({ example: 'Acme Workspace' })
  workspaceName: string;

  @ApiProperty({ enum: Role, example: Role.OWNER })
  role: Role;

  @ApiProperty({ enum: Plan, example: Plan.FREE })
  plan: Plan;

  @ApiProperty({ example: '2026-11-04T08:00:00.000Z' })
  joinedAt: Date;
}

export class UserProfileDto {
  @ApiProperty({ example: '358733f0-bb5f-407e-a960-b2cb704d481f' })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: 'jane@acme.com' })
  email: string;

  @ApiProperty({ example: '01712345678' })
  phone: string;

  @ApiPropertyOptional({
    example: 'https://assets.documind.ai/avatars/user-id/1699999999-uuid.jpg',
    nullable: true,
  })
  avatarUrl: string | null;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: false })
  isPhoneVerified: boolean;

  @ApiProperty({ example: '2026-11-04T08:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: [WorkspaceMembershipDto] })
  workspaces: WorkspaceMembershipDto[];
}

export class UserProfileResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'User profile retrieved successfully' })
  message: string;

  @ApiProperty({ type: UserProfileDto })
  data: UserProfileDto;
}

export class UserActionResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Operation completed successfully' })
  message: string;

  @ApiPropertyOptional({ example: { cooldownSeconds: 60 } })
  data?: Record<string, unknown>;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane Doe', minLength: 2 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: 'jane.new@acme.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '01799887766', minLength: 11 })
  @IsOptional()
  @IsString()
  @MinLength(11)
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://assets.documind.ai/avatars/user-id/1699999999-uuid.jpg',
    description: 'Direct public URL or Cloudflare R2 URL for user avatar',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class UpdatePasswordDto {
  @ApiProperty({ example: 'OldPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty({ example: 'NewSecretPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to invalidate all active refresh tokens for this user',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  revokeOtherSessions?: boolean;
}

export class AvatarUploadUrlRequestDto {
  @ApiPropertyOptional({
    example: 'image/jpeg',
    enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    default: 'image/jpeg',
  })
  @IsOptional()
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'image/gif'], {
    message: 'contentType must be one of: image/jpeg, image/png, image/webp, image/gif',
  })
  contentType?: string;

  @ApiPropertyOptional({ example: 'profile-picture.jpg' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ example: 2048576, description: 'File size in bytes (max 10MB)' })
  @IsOptional()
  @IsNumber()
  fileSize?: number;
}

export class AvatarUploadUrlDataDto {
  @ApiProperty({
    example: 'https://<account-id>.r2.cloudflarestorage.com/documind-avatars/avatars/user-id/...',
    description: 'Direct presigned PUT URL to Cloudflare R2',
  })
  uploadUrl: string;

  @ApiProperty({
    example: 'https://assets.documind.ai/avatars/user-id/1700000000-uuid.jpg',
    description: 'Public URL of the photo once uploaded',
  })
  publicUrl: string;

  @ApiProperty({ example: 'avatars/user-id/1700000000-uuid.jpg' })
  key: string;

  @ApiProperty({ example: 3600, description: 'URL expiry in seconds' })
  expiresIn: number;
}

export class AvatarUploadUrlResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Presigned upload URL generated successfully' })
  message: string;

  @ApiProperty({ type: AvatarUploadUrlDataDto })
  data: AvatarUploadUrlDataDto;
}

export class ConfirmAvatarDto {
  @ApiProperty({
    example: 'https://assets.documind.ai/avatars/user-id/1700000000-uuid.jpg',
    description: 'Public URL of the uploaded image to persist in PostgreSQL User table',
  })
  @IsString()
  avatarUrl: string;

  @ApiPropertyOptional({
    example: 'avatars/user-id/1700000000-uuid.jpg',
    description: 'Optional R2 object key',
  })
  @IsOptional()
  @IsString()
  key?: string;
}
