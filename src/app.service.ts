import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export class HomeResponse {
  @ApiProperty({ example: 'Waitium API' })
  message: string;

  @ApiProperty({ example: '1.0.0' })
  version: string;

  @ApiProperty({ example: '2026-02-22T09:00:00.000Z' })
  timestamp: string;
}

@Injectable()
export class AppService {
  getHome(): HomeResponse {
    return {
      message: 'Waitium API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
