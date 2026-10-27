import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ErrorDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  SuccessDto,
  TokenPairDto,
  ValidationErrorDto,
} from './dto/auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@ApiBadRequestResponse({ description: 'Validation failed', type: ValidationErrorDto })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: 'Create a user and their first workspace' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ description: 'Registered; tokens issued', type: TokenPairDto })
  @ApiConflictResponse({ description: 'Email already registered', type: ErrorDto })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiCreatedResponse({ description: 'Tokens issued', type: TokenPairDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ErrorDto })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'The presented token is revoked and a new pair is returned. Replaying a revoked token revokes all sessions for that user.',
  })
  @ApiBody({ type: RefreshDto })
  @ApiCreatedResponse({ description: 'New token pair', type: TokenPairDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or reused refresh token',
    type: ErrorDto,
  })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Revoke one refresh token (this session)' })
  @ApiBody({ type: RefreshDto })
  @ApiCreatedResponse({ description: 'Token revoked (idempotent)', type: SuccessDto })
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: 'All sessions revoked', type: SuccessDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token', type: ErrorDto })
  @UseGuards(AuthGuard('jwt'))
  @Post('logout-all')
  logoutAll(@Req() req: { user: { userId: string } }) {
    return this.auth.logoutAll(req.user.userId);
  }
}
