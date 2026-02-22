import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppService, HomeResponse } from './app.service';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns API status, version, and current timestamp',
  })
  @ApiOkResponse({ description: 'API is running', type: HomeResponse })
  getHome(): HomeResponse {
    return this.appService.getHome();
  }
}
