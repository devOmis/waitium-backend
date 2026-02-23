import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiPropertyOptional({ example: '482901', description: '6-digit verification code' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;

  @ApiPropertyOptional({ description: 'UUID token from the clickable link' })
  @IsOptional()
  @IsString()
  token?: string;
}
