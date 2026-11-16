import {
  Controller,
  Get,
  Put,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DocumentNumberingService } from './document-numbering.service';
import { TenantContextGuard } from '../guards/tenant-context.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentContext } from '../decorators/current-context.decorator';
import { OptionalLegalEntityIdPipe } from '../pipes/legal-entity-id.pipe';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

const UpsertSequenceSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  documentType: z.string().min(2).max(50),
  periodKey: z.string().max(20).optional(),
  prefix: z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/),
  startingNumber: z.number().int().min(1).optional(),
  padding: z.number().int().min(1).max(12).optional(),
  fiscalYearFormat: z.enum(['YYYY', 'YY', 'NONE']).optional(),
  annualResetPolicy: z.enum(['ANNUAL', 'NEVER']).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().max(300).optional(),
});

const AllocateNumberSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  documentType: z.string().min(2).max(50),
  sourceType: z.string().max(60).optional(),
  sourceId: z.string().uuid().optional(),
});

@Controller('api/v1/document-numbering')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class DocumentNumberingController {
  constructor(private readonly numberingService: DocumentNumberingService) {}

  @Get('sequences')
  @RequirePermissions('tenant.read')
  async listSequences(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('documentType') documentType?: string
  ) {
    const data = await this.numberingService.listSequences(context, {
      legalEntityId,
      branchId,
      documentType,
    });
    return { success: true, data };
  }

  @Put('sequences')
  @RequirePermissions('tenant.manage')
  async upsertSequence(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = UpsertSequenceSchema.parse(body);
    const data = await this.numberingService.upsertSequenceConfig(context, dto);
    return { success: true, data };
  }

  @Post('allocate')
  @RequirePermissions('tenant.read')
  async allocateNext(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const dto = AllocateNumberSchema.parse(body);
    const data = await this.numberingService.allocateNextNumber(context, dto);
    return { success: true, data };
  }

  @Get('allocations')
  @RequirePermissions('tenant.read')
  async listAllocations(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', OptionalLegalEntityIdPipe) legalEntityId?: string,
    @Query('documentType') documentType?: string,
    @Query('limit') limit?: string
  ) {
    const data = await this.numberingService.listAllocations(context, {
      legalEntityId,
      documentType,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return { success: true, data };
  }
}
