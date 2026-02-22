import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength, MaxLength, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '482901', description: '6-digit code from email' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: 'NewStrongPass1' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  newPassword: string;
}
