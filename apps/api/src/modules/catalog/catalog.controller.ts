import {
  Controller,
  Post,
  Get,
  Put,
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
  @RequirePermissions('catalog.category.create')
  async createCategory(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateCategoryRequestSchema.parse(body);
    const data = await this.catalogService.createCategory(context, validatedDto);
    return { success: true, data };
  }

  @Put('categories/:id')
  @RequirePermissions('catalog.category.update')
  async updateCategory(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateCategoryRequestSchema.parse(body);
    const data = await this.catalogService.updateCategory(context, id, validatedDto);
    return { success: true, data };
  }

  @Get('categories')
  async getCategories(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = CategoryListQuerySchema.parse(query);
    const data = await this.catalogService.getCategories(context, validatedQuery);
    return { success: true, data };
  }

  @Get('categories/:id')
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
  @RequirePermissions('catalog.uom.create')
  async createUom(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateUomRequestSchema.parse(body);
    const data = await this.catalogService.createUom(context, validatedDto);
    return { success: true, data };
  }

  @Get('uom')
  async getUoms(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getUoms(context);
    return { success: true, data };
  }

  @Post('uom-conversions')
  @RequirePermissions('catalog.uom.create')
  async createUomConversion(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateUomConversionRequestSchema.parse(body);
    const data = await this.catalogService.createUomConversion(context, validatedDto);
    return { success: true, data };
  }

  @Get('uom-conversions')
  async getUomConversions(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getUomConversions(context);
    return { success: true, data };
  }

  // ==================================================================
  // Items / Products
  // ==================================================================

  @Post('items')
  @RequirePermissions('catalog.item.create')
  async createItem(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateItemRequestSchema.parse(body);
    const data = await this.catalogService.createItem(context, validatedDto);
    return { success: true, data };
  }

  @Put('items/:id')
  @RequirePermissions('catalog.item.update')
  async updateItem(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const validatedDto = UpdateItemRequestSchema.parse(body);
    const data = await this.catalogService.updateItem(context, id, validatedDto);
    return { success: true, data };
  }

  @Get('items')
  async getItems(
    @CurrentContext() context: TenantContext,
    @Query() query: unknown
  ) {
    const validatedQuery = ItemListQuerySchema.parse(query);
    const data = await this.catalogService.getItems(context, validatedQuery);
    return { success: true, data };
  }

  @Get('items/:id')
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
  @RequirePermissions('catalog.item.update')
  async createVariant(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateItemVariantRequestSchema.parse(body);
    const data = await this.catalogService.createVariant(context, validatedDto);
    return { success: true, data };
  }

  @Get('items/:id/variants')
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
  @RequirePermissions('catalog.pricing.manage')
  async setBranchPrice(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = SetBranchPriceRequestSchema.parse(body);
    const data = await this.catalogService.setBranchPrice(context, validatedDto);
    return { success: true, data };
  }

  @Get('branches/:branchId/prices')
  async getBranchPrices(
    @CurrentContext() context: TenantContext,
    @Param('branchId') branchId: string
  ) {
    const data = await this.catalogService.getBranchPrices(context, branchId);
    return { success: true, data };
  }

  @Get('branches/:branchId/items/:itemId/effective-price')
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
  @RequirePermissions('catalog.supplier.create')
  async createSupplier(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown
  ) {
    const validatedDto = CreateSupplierRequestSchema.parse(body);
    const data = await this.catalogService.createSupplier(context, validatedDto);
    return { success: true, data };
  }

  @Get('suppliers')
  async getSuppliers(@CurrentContext() context: TenantContext) {
    const data = await this.catalogService.getSuppliers(context);
    return { success: true, data };
  }
}
