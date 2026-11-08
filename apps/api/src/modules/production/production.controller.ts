import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ProductionService } from './production.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { IndustryEntitlementGuard } from '../../common/guards/industry-entitlement.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireCapability } from '../../common/decorators/industry-entitlement.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateRecipeSchema,
  CreateProductionBatchSchema,
  CompleteProductionBatchSchema,
  CreateWasteRecordSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/production')
@UseGuards(TenantContextGuard, PermissionsGuard, IndustryEntitlementGuard)
@RequireCapability('production.recipes')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Post('recipes')
  @RequirePermissions('production.recipe.create')
  async createRecipe(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateRecipeSchema.parse(body);
    const data = await this.productionService.createRecipe(context, validatedDto);
    return { success: true, data };
  }

  @Get('recipes')
  async getRecipes(
    @CurrentContext() context: TenantContext,
    @Query('outputItemId') outputItemId?: string
  ) {
    const data = await this.productionService.getRecipes(context, outputItemId);
    return { success: true, data };
  }

  @Get('recipes/:id/cost')
  async getRecipeCost(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.productionService.getRecipeCost(context, id);
    return { success: true, data };
  }

  @Post('batches')
  @RequirePermissions('production.batch.create')
  async createBatch(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateProductionBatchSchema.parse(body);
    const data = await this.productionService.createProductionBatch(context, validatedDto);
    return { success: true, data };
  }

  @Post('batches/:id/complete')
  @RequirePermissions('production.batch.complete')
  async completeBatch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = CompleteProductionBatchSchema.parse(body);
    const data = await this.productionService.completeProductionBatch(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('waste')
  @RequirePermissions('production.waste.create')
  async recordWaste(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateWasteRecordSchema.parse(body);
    const data = await this.productionService.recordWaste(context, validatedDto);
    return { success: true, data };
  }
}
