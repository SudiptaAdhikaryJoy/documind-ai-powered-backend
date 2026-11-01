import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthResponseDto,
  ErrorDto,
  ForgotPasswordDto,
  LoginDto,
  PhoneLoginRequestDto,
  PhoneLoginVerifyDto,
  RefreshDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  SuccessDto,
  TokenPairDto,
  ValidationErrorDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@ApiBadRequestResponse({
  description: 'Validation failed',
  type: ValidationErrorDto,
})
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: 'Create a user and their first workspace' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Registered; tokens issued and verification OTPs sent',
    type: AuthResponseDto,
  })
  @ApiConflictResponse({
    description: 'Email or phone already registered',
    type: ErrorDto,
  })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @ApiOperation({ summary: 'Log in with email or phone and password' })
  @ApiBody({ type: LoginDto })
  @ApiCreatedResponse({ description: 'Tokens issued', type: AuthResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials',
    type: ErrorDto,
  })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiOperation({ summary: 'Verify email or phone OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiCreatedResponse({ description: 'Verification successful', type: SuccessDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired code', type: ErrorDto })
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @ApiOperation({ summary: 'Resend OTP to email or phone' })
  @ApiBody({ type: ResendOtpDto })
  @ApiCreatedResponse({ description: 'Verification code resent' })
  @Post('otp/resend')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto);
  }

  @ApiOperation({ summary: 'Request password reset code via email or SMS' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiCreatedResponse({ description: 'Password reset code dispatched' })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @ApiOperation({ summary: 'Reset password using OTP code' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiCreatedResponse({ description: 'Password reset successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired code', type: ErrorDto })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @ApiOperation({ summary: 'Request passwordless login code via SMS OTP' })
  @ApiBody({ type: PhoneLoginRequestDto })
  @ApiCreatedResponse({ description: 'Login code dispatched to phone' })
  @Post('login-otp/request')
  requestPhoneLogin(@Body() dto: PhoneLoginRequestDto) {
    return this.auth.requestPhoneLogin(dto);
  }

  @ApiOperation({ summary: 'Verify phone login OTP and issue token pair' })
  @ApiBody({ type: PhoneLoginVerifyDto })
  @ApiCreatedResponse({ description: 'Tokens issued', type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired code', type: ErrorDto })
  @Post('login-otp/verify')
  verifyPhoneLogin(@Body() dto: PhoneLoginVerifyDto) {
    return this.auth.verifyPhoneLogin(dto);
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
  @ApiCreatedResponse({
    description: 'Token revoked (idempotent)',
    type: SuccessDto,
  })
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: 'All sessions revoked', type: SuccessDto })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorDto,
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  logoutAll(@Req() req: { user: { userId: string } }) {
    return this.auth.logoutAll(req.user.userId);
  }
}
