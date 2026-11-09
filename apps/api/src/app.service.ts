import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly dbService: DatabaseService) {}

  getLiveness() {
    return {
      status: 'ok',
      service: 'restaurant-cloud-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    let isDbConnected = false;
    try {
      isDbConnected = await this.dbService.ping();
    } catch {
      isDbConnected = false;
    }

    if (!isDbConnected) {
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        service: 'restaurant-cloud-api',
        checks: {
          database: 'disconnected',
        },
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      service: 'restaurant-cloud-api',
      checks: {
        database: 'connected',
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getHealth() {
    return await this.getReadiness();
  }
}
