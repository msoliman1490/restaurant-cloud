import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import {
  CreateCategoryRequestSchema,
  UpdateCategoryRequestSchema,
  CategoryListQuerySchema,
  CreateUomRequestSchema,
  CreateUomConversionRequestSchema,
  CreateItemRequestSchema,
  UpdateItemRequestSchema,
  ChangeItemPriceRequestSchema,
  ChangeItemCostRequestSchema,
  ArchiveItemRequestSchema,
  ItemListQuerySchema,
  CreateItemVariantRequestSchema,
  UpdateItemVariantRequestSchema,
  SetBranchPriceRequestSchema,
  CreateSupplierRequestSchema,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

@Controller('api/v1/catalog')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ==================================================================
  // Categories
  // ==================================================================

  @Post('categories')
  @RequirePermissions('category.create')
  async createCategory(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateCategoryRequestSchema.parse(body);
    const data = await this.catalogService.createCategory(context, validatedDto);
    return { success: true, data };
  }

  @Put('categories/:id')
  @RequirePermissions('category.update')
  async updateCategory(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateCategoryRequestSchema.parse(body);
    const data = await this.catalogService.updateCategory(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('categories/:id')
  @RequirePermissions('category.delete')
  async deleteCategory(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.catalogService.deleteCategory(context, id);
    return { success: true, data };
  }

  @Get('categories')
  @RequirePermissions('category.view')
  async getCategories(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = CategoryListQuerySchema.parse(query);
    const data = await this.catalogService.getCategories(context, validatedQuery);
    return { success: true, data };
  }

  @Get('categories/:id')
  @RequirePermissions('category.view')
  async getCategoryById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.catalogService.getCategoryById(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // Units of Measure (UoM)
  // ==================================================================

  @Post('uom')
  @RequirePermissions('uom.create')
  async createUom(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateUomRequestSchema.parse(body);
    const data = await this.catalogService.createUom(context, validatedDto);
    return { success: true, data };
  }

  @Get('uom')
  @RequirePermissions('uom.view')
  async getUoms(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getUoms(context);
    return { success: true, data };
  }

  @Post('uom-conversions')
  @RequirePermissions('uom.create')
  async createUomConversion(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateUomConversionRequestSchema.parse(body);
    const data = await this.catalogService.createUomConversion(context, validatedDto);
    return { success: true, data };
  }

  @Get('uom-conversions')
  @RequirePermissions('uom.view')
  async getUomConversions(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getUomConversions(context);
    return { success: true, data };
  }

  // ==================================================================
  // Items / Products
  // ==================================================================

  @Post('items')
  @RequirePermissions('item.create')
  async createItem(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateItemRequestSchema.parse(body);
    const data = await this.catalogService.createItem(context, validatedDto);
    return { success: true, data };
  }

  @Put('items/:id')
  @RequirePermissions('item.update')
  async updateItemPut(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateItemRequestSchema.parse(body);
    const data = await this.catalogService.updateItem(context, id, validatedDto);
    return { success: true, data };
  }

  @Patch('items/:id')
  @RequirePermissions('item.update')
  async updateItemPatch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateItemRequestSchema.parse(body);
    const data = await this.catalogService.updateItem(context, id, validatedDto);
    return { success: true, data };
  }

  @Patch('items/:id/price')
  @RequirePermissions('item.change_price')
  async changeItemPrice(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = ChangeItemPriceRequestSchema.parse(body);
    const data = await this.catalogService.changeItemPrice(context, id, validatedDto);
    return { success: true, data };
  }

  @Patch('items/:id/cost')
  @RequirePermissions('item.change_cost')
  async changeItemCost(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = ChangeItemCostRequestSchema.parse(body);
    const data = await this.catalogService.changeItemCost(context, id, validatedDto);
    return { success: true, data };
  }

  @Delete('items/:id')
  @RequirePermissions('item.delete')
  async deleteItem(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.catalogService.deleteItem(context, id);
    return { success: true, data };
  }

  @Post('items/:id/archive')
  @RequirePermissions('item.archive')
  async archiveItem(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = ArchiveItemRequestSchema.optional().parse(body || {});
    const data = await this.catalogService.archiveItem(context, id, validatedDto);
    return { success: true, data };
  }

  @Post('items/:id/restore')
  @RequirePermissions('item.restore')
  async restoreItem(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.catalogService.restoreItem(context, id);
    return { success: true, data };
  }

  @Get('items')
  @RequirePermissions('item.view')
  async getItems(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = ItemListQuerySchema.parse(query);
    const data = await this.catalogService.getItems(context, validatedQuery);
    return { success: true, data };
  }

  @Get('items/:id')
  @RequirePermissions('item.view')
  async getItemById(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string
  ) {
    const data = await this.catalogService.getItemById(context, id);
    return { success: true, data };
  }

  // ==================================================================
  // Variants
  // ==================================================================

  @Post('variants')
  @RequirePermissions('item.update')
  async createVariant(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateItemVariantRequestSchema.parse(body);
    const data = await this.catalogService.createVariant(context, validatedDto);
    return { success: true, data };
  }

  @Get('items/:id/variants')
  @RequirePermissions('item.view')
  async getVariantsByItem(
    @CurrentContext() context: TenantContext,
    @Param('id') itemId: string
  ) {
    const data = await this.catalogService.getVariantsByItem(context, itemId);
    return { success: true, data };
  }

  // ==================================================================
  // Branch Specific Pricing
  // ==================================================================

  @Post('branch-prices')
  @RequirePermissions('item.change_price')
  async setBranchPrice(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = SetBranchPriceRequestSchema.parse(body);
    const data = await this.catalogService.setBranchPrice(context, validatedDto);
    return { success: true, data };
  }

  @Get('branches/:branchId/prices')
  @RequirePermissions('item.view')
  async getBranchPrices(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string
  ) {
    const data = await this.catalogService.getBranchPrices(context, branchId);
    return { success: true, data };
  }

  @Get('branches/:branchId/items/:itemId/effective-price')
  @RequirePermissions('item.view')
  async getEffectiveItemPrice(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string
  ) {
    const data = await this.catalogService.getEffectiveItemPrice(context, branchId, itemId);
    return { success: true, data };
  }

  // ==================================================================
  // Suppliers
  // ==================================================================

  @Post('suppliers')
  @RequirePermissions('purchase.create')
  async createSupplier(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateSupplierRequestSchema.parse(body);
    const data = await this.catalogService.createSupplier(context, validatedDto);
    return { success: true, data };
  }

  @Get('suppliers')
  @RequirePermissions('purchase.approve')
  async getSuppliers(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getSuppliers(context);
    return { success: true, data };
  }
}
