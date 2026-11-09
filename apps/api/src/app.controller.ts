import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  async getHealth() {
    return await this.appService.getHealth();
  }

  @Get('health/liveness')
  getLiveness() {
    return this.appService.getLiveness();
  }

  @Get('health/readiness')
  async getReadiness() {
    return await this.appService.getReadiness();
  }
}
