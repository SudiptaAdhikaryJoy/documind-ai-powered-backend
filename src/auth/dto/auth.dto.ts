import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, Length, MinLength, ValidateIf } from 'class-validator';
import { OtpPurpose } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Must be unique' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'S3cretPass!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Jane Doe', minLength: 2 })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @MinLength(11)
  phone: string;

  @ApiProperty({
    example: 'Acme Inc',
    minLength: 2,
    description: 'Name of the first workspace; the user becomes its OWNER',
  })
  @IsString()
  @MinLength(2)
  workspaceName: string;
}

export class RefreshDto {
  @ApiProperty({
    example: '9f2c1b7e4a6d...64-hex-chars',
    description: 'Refresh token from login/register/refresh',
  })
  @IsString()
  refreshToken: string;
}

export class LoginDto {
  @ApiPropertyOptional({
    example: 'jane@acme.com',
    description: 'Required if phone is not provided',
  })
  @ValidateIf((o: LoginDto) => !o.phone || o.email !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: '01712345678',
    description: 'Required if email is not provided',
  })
  @ValidateIf((o: LoginDto) => !o.email || o.phone !== undefined)
  @IsString()
  @MinLength(11)
  phone?: string;

  @ApiProperty({ example: 'S3cretPass!' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class AuthDataDto {
  @ApiProperty({ example: 'Jane Doe' })
  userName: string;

  @ApiProperty({ example: 'jane@acme.com' })
  email: string;

  @ApiProperty({ example: 'user-uuid' })
  id: string;

  @ApiProperty({ example: '01712345678' })
  phone: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived JWT; send as Authorization: Bearer <token>',
  })
  accessToken: string;

  @ApiProperty({
    example: '9f2c1b7e4a6d...64-hex-chars',
    description: 'Single-use opaque token; rotated on every refresh',
  })
  refreshToken: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: 201 })
  statusCode: number;

  @ApiProperty({ example: 'User logged in successfully' })
  message: string;

  @ApiProperty({ type: AuthDataDto })
  data: AuthDataDto;
}

export class TokenPairDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived JWT; send as Authorization: Bearer <token>',
  })
  accessToken: string;

  @ApiProperty({
    example: '9f2c1b7e4a6d...64-hex-chars',
    description: 'Single-use opaque token; rotated on every refresh',
  })
  refreshToken: string;
}

export class SuccessDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class ErrorDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Invalid credentials' })
  message: string;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;
}

export class ValidationErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    type: [String],
    example: [
      'email must be an email',
      'password must be longer than or equal to 8 characters',
    ],
  })
  message: string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Target email address or phone number' })
  @IsString()
  target: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.SIGNUP_EMAIL_VERIFICATION })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}

export class ResendOtpDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Target email address or phone number' })
  @IsString()
  target: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.SIGNUP_EMAIL_VERIFICATION })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Registered email or phone number' })
  @IsString()
  target: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Registered email or phone number' })
  @IsString()
  target: string;

  @ApiProperty({ example: '123456', description: '6-digit verification code' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: 'NewSecretPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class PhoneLoginRequestDto {
  @ApiProperty({ example: '01712345678', minLength: 11 })
  @IsString()
  @MinLength(11)
  phone: string;
}

export class PhoneLoginVerifyDto {
  @ApiProperty({ example: '01712345678', minLength: 11 })
  @IsString()
  @MinLength(11)
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP received via SMS' })
  @IsString()
  @Length(6, 6)
  code: string;
}

