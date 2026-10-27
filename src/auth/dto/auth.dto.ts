import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, ValidateIf } from 'class-validator';

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
    example: ['email must be an email', 'password must be longer than or equal to 8 characters'],
  })
  message: string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}
