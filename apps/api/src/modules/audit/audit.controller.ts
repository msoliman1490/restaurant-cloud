import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { AuditLogQuerySchema } from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @UseGuards(TenantContextGuard, PermissionsGuard)
  @RequirePermissions('audit.read')
  async getAuditLogs(
    @CurrentContext() context: TenantContext,
    @Query() queryParams: unknown
  ) {
    const validatedQuery = AuditLogQuerySchema.parse(queryParams);
    const data = await this.auditService.queryLogs(context, validatedQuery);
    return {
      success: true,
      data,
    };
  }
}
