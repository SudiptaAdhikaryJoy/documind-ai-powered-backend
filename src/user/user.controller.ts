import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtUserPayload } from '../auth/jwt.strategy';
import { UserService } from './user.service';
import {
  AvatarUploadUrlRequestDto,
  AvatarUploadUrlResponseDto,
  ConfirmAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  UserActionResponseDto,
  UserProfileResponseDto,
} from './dto/user.dto';

@ApiTags('user')
@Controller(['user', 'users'])
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: 'Get current user profile and workspaces' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: JwtUserPayload) {
    return this.userService.getProfile(user.userId);
  }

  @ApiOperation({ summary: 'Get current user profile (alias for /profile)' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: JwtUserPayload) {
    return this.userService.getProfile(user.userId);
  }

  @ApiOperation({ summary: 'Update profile details (name, email, phone, avatarUrl)' })
  @ApiBearerAuth()
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed or no fields provided' })
  @ApiConflictResponse({ description: 'Email or phone already taken' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update profile details (PUT alias)' })
  @ApiBearerAuth()
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @UseGuards(JwtAuthGuard)
  @Put('profile')
  updateProfilePut(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update password with current password verification' })
  @ApiBearerAuth()
  @ApiBody({ type: UpdatePasswordDto })
  @ApiOkResponse({ type: UserActionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid data or new password matches current' })
  @ApiUnauthorizedResponse({ description: 'Current password does not match' })
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  updatePassword(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdatePasswordDto,
  ) {
    return this.userService.updatePassword(user.userId, dto);
  }

  @ApiOperation({
    summary: 'Request presigned direct upload URL for Cloudflare R2 (Instagram style)',
    description:
      'Frontend requests this URL and then uploads the photo directly to Cloudflare R2 via HTTP PUT.',
  })
  @ApiBearerAuth()
  @ApiBody({ type: AvatarUploadUrlRequestDto, required: false })
  @ApiOkResponse({ type: AvatarUploadUrlResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('avatar/presigned-url')
  createAvatarUploadUrl(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: AvatarUploadUrlRequestDto,
  ) {
    return this.userService.createAvatarUploadUrl(user.userId, dto);
  }

  @ApiOperation({
    summary: 'Confirm avatar upload and save public link to PostgreSQL',
    description:
      'Called by frontend after successfully uploading photo directly to Cloudflare R2.',
  })
  @ApiBearerAuth()
  @ApiBody({ type: ConfirmAvatarDto })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('avatar/confirm')
  confirmAvatar(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: ConfirmAvatarDto,
  ) {
    return this.userService.confirmAvatar(user.userId, dto);
  }

  @ApiOperation({ summary: 'Remove avatar profile photo' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserActionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Delete('avatar')
  deleteAvatar(@CurrentUser() user: JwtUserPayload) {
    return this.userService.deleteAvatar(user.userId);
  }

  @ApiOperation({
    summary: 'Cloudflare R2 Event Notification webhook',
    description:
      'Automatically called by Cloudflare R2 when an object is uploaded to persist the link in PostgreSQL.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('avatar/webhook')
  handleWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers('x-r2-webhook-secret') secretHeader?: string,
  ) {
    return this.userService.handleR2Webhook(payload, secretHeader);
  }

  @ApiOperation({ summary: 'Request OTP verification code for current email' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserActionResponseDto })
  @ApiBadRequestResponse({ description: 'Email is already verified' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('verify-email/request')
  requestEmailVerification(@CurrentUser() user: JwtUserPayload) {
    return this.userService.requestEmailVerification(user.userId);
  }

  @ApiOperation({ summary: 'Request OTP verification code for current phone' })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserActionResponseDto })
  @ApiBadRequestResponse({ description: 'Phone number is already verified' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('verify-phone/request')
  requestPhoneVerification(@CurrentUser() user: JwtUserPayload) {
    return this.userService.requestPhoneVerification(user.userId);
  }
}
