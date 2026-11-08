import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  categories,
  unitsOfMeasure,
  uomConversions,
  items,
  itemVariants,
  branchItemPrices,
  suppliers,
} from '@restaurant-cloud/database';
import {
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CategoryListQuery,
  CreateUomRequest,
  CreateUomConversionRequest,
  CreateItemRequest,
  UpdateItemRequest,
  ItemListQuery,
  CreateItemVariantRequest,
  UpdateItemVariantRequest,
  SetBranchPriceRequest,
  CreateSupplierRequest,
  UpdateSupplierRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, or, ilike, desc, asc } from 'drizzle-orm';

@Injectable()
export class CatalogService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  // ==================================================================
  // 1. Categories
  // ==================================================================

  async createCategory(context: TenantContext, dto: CreateCategoryRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Check code uniqueness within tenant
      const [existing] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, context.tenantId),
            eq(categories.code, dto.code)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Category code '${dto.code}' already exists in this tenant`);
      }

      if (dto.parentId) {
        const [parent] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.tenantId, context.tenantId),
              eq(categories.id, dto.parentId)
            )
          )
          .limit(1);

        if (!parent) {
          throw new NotFoundException(`Parent category '${dto.parentId}' not found`);
        }
      }

      const [newCategory] = await tx
        .insert(categories)
        .values({
          tenantId: context.tenantId,
          code: dto.code,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          parentId: dto.parentId || null,
          displayOrder: dto.displayOrder ?? 0,
          isActive: dto.isActive ?? true,
        })
        .returning();

      if (!newCategory) throw new Error('Failed to create category');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'CATEGORY_CREATED',
          entityType: 'category',
          entityId: newCategory.id,
          afterState: dto,
        },
        tx
      );

      return newCategory;
    });
  }

  async updateCategory(context: TenantContext, id: string, dto: UpdateCategoryRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, context.tenantId),
            eq(categories.id, id)
          )
        )
        .limit(1);

      if (!existing) {
        throw new NotFoundException(`Category '${id}' not found`);
      }

      if (dto.parentId && dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }

      const updateValues: Partial<typeof categories.$inferInsert> = {};
      if (dto.code !== undefined) updateValues.code = dto.code;
      if (dto.nameAr !== undefined) updateValues.nameAr = dto.nameAr;
      if (dto.nameEn !== undefined) updateValues.nameEn = dto.nameEn;
      if (dto.parentId !== undefined) updateValues.parentId = dto.parentId;
      if (dto.displayOrder !== undefined) updateValues.displayOrder = dto.displayOrder;
      if (dto.isActive !== undefined) updateValues.isActive = dto.isActive;

      const [updated] = await tx
        .update(categories)
        .set(updateValues)
        .where(
          and(
            eq(categories.tenantId, context.tenantId),
            eq(categories.id, id)
          )
        )
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'CATEGORY_UPDATED',
          entityType: 'category',
          entityId: id,
          beforeState: existing,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async getCategories(context: TenantContext, query?: CategoryListQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(categories.tenantId, context.tenantId)];

      if (query?.parentId !== undefined) {
        if (query.parentId === null) {
          conditions.push(sql`${categories.parentId} IS NULL`);
        } else {
          conditions.push(eq(categories.parentId, query.parentId));
        }
      }

      if (query?.isActive !== undefined) {
        conditions.push(eq(categories.isActive, query.isActive));
      }

      if (query?.search) {
        const searchTerm = `%${query.search}%`;
        conditions.push(
          or(
            ilike(categories.nameAr, searchTerm),
            ilike(categories.nameEn, searchTerm),
            ilike(categories.code, searchTerm)
          )!
        );
      }

      return await tx
        .select()
        .from(categories)
        .where(and(...conditions))
        .orderBy(asc(categories.displayOrder), asc(categories.nameAr));
    });
  }

  async getCategoryById(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [category] = await tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, context.tenantId),
            eq(categories.id, id)
          )
        )
        .limit(1);

      if (!category) {
        throw new NotFoundException(`Category '${id}' not found`);
      }

      return category;
    });
  }

  // ==================================================================
  // 2. Units of Measure (UoM)
  // ==================================================================

  async createUom(context: TenantContext, dto: CreateUomRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: unitsOfMeasure.id })
        .from(unitsOfMeasure)
        .where(
          and(
            eq(unitsOfMeasure.tenantId, context.tenantId),
            eq(unitsOfMeasure.code, dto.code)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`UoM code '${dto.code}' already exists in this tenant`);
      }

      const [newUom] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId: context.tenantId,
          code: dto.code.toUpperCase(),
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          category: dto.category,
          isBase: dto.isBase ?? false,
          isActive: dto.isActive ?? true,
        })
        .returning();

      return newUom;
    });
  }

  async getUoms(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(unitsOfMeasure)
        .where(eq(unitsOfMeasure.tenantId, context.tenantId))
        .orderBy(asc(unitsOfMeasure.code));
    });
  }

  async createUomConversion(context: TenantContext, dto: CreateUomConversionRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [conversion] = await tx
        .insert(uomConversions)
        .values({
          tenantId: context.tenantId,
          fromUomId: dto.fromUomId,
          toUomId: dto.toUomId,
          multiplier: dto.multiplier,
        })
        .returning();

      return conversion;
    });
  }

  async getUomConversions(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(uomConversions)
        .where(eq(uomConversions.tenantId, context.tenantId));
    });
  }

  // ==================================================================
  // 3. Products / Items Catalog
  // ==================================================================

  async createItem(context: TenantContext, dto: CreateItemRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate SKU uniqueness within tenant
      const [existingSku] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.sku, dto.sku)
          )
        )
        .limit(1);

      if (existingSku) {
        throw new ConflictException(`Item with SKU '${dto.sku}' already exists in this tenant`);
      }

      const [newItem] = await tx
        .insert(items)
        .values({
          tenantId: context.tenantId,
          legalEntityOwnerId: dto.legalEntityOwnerId,
          categoryId: dto.categoryId || null,
          baseUomId: dto.baseUomId,
          sku: dto.sku,
          barcode: dto.barcode || null,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          productType: dto.productType,
          trackingPolicy: dto.trackingPolicy,
          costingMethod: dto.costingMethod,
          defaultCost: dto.defaultCost ?? '0.0000',
          defaultPrice: dto.defaultPrice ?? '0.0000',
          taxRate: dto.taxRate ?? '0.1500',
          isSold: dto.isSold ?? true,
          isPurchased: dto.isPurchased ?? true,
          isActive: dto.isActive ?? true,
        })
        .returning();

      if (!newItem) throw new Error('Failed to create item');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ITEM_CREATED',
          entityType: 'item',
          entityId: newItem.id,
          afterState: dto,
        },
        tx
      );

      return newItem;
    });
  }

  async updateItem(context: TenantContext, id: string, dto: UpdateItemRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(items)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.id, id)
          )
        )
        .limit(1);

      if (!existing) {
        throw new NotFoundException(`Item '${id}' not found`);
      }

      if (dto.sku && dto.sku !== existing.sku) {
        const [conflict] = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.tenantId, context.tenantId),
              eq(items.sku, dto.sku)
            )
          )
          .limit(1);

        if (conflict) {
          throw new ConflictException(`Item with SKU '${dto.sku}' already exists`);
        }
      }

      const updateValues: Partial<typeof items.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (dto.categoryId !== undefined) updateValues.categoryId = dto.categoryId;
      if (dto.baseUomId !== undefined) updateValues.baseUomId = dto.baseUomId;
      if (dto.sku !== undefined) updateValues.sku = dto.sku;
      if (dto.barcode !== undefined) updateValues.barcode = dto.barcode;
      if (dto.nameAr !== undefined) updateValues.nameAr = dto.nameAr;
      if (dto.nameEn !== undefined) updateValues.nameEn = dto.nameEn;
      if (dto.productType !== undefined) updateValues.productType = dto.productType;
      if (dto.trackingPolicy !== undefined) updateValues.trackingPolicy = dto.trackingPolicy;
      if (dto.costingMethod !== undefined) updateValues.costingMethod = dto.costingMethod;
      if (dto.defaultCost !== undefined) updateValues.defaultCost = dto.defaultCost;
      if (dto.defaultPrice !== undefined) updateValues.defaultPrice = dto.defaultPrice;
      if (dto.taxRate !== undefined) updateValues.taxRate = dto.taxRate;
      if (dto.isSold !== undefined) updateValues.isSold = dto.isSold;
      if (dto.isPurchased !== undefined) updateValues.isPurchased = dto.isPurchased;
      if (dto.isActive !== undefined) updateValues.isActive = dto.isActive;

      const [updated] = await tx
        .update(items)
        .set(updateValues)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.id, id)
          )
        )
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'ITEM_UPDATED',
          entityType: 'item',
          entityId: id,
          beforeState: existing,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async getItemById(context: TenantContext, id: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [item] = await tx
        .select()
        .from(items)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.id, id)
          )
        )
        .limit(1);

      if (!item) {
        throw new NotFoundException(`Item '${id}' not found`);
      }

      return item;
    });
  }

  async getItems(context: TenantContext, query?: ItemListQuery) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(items.tenantId, context.tenantId)];

      if (query?.categoryId) {
        conditions.push(eq(items.categoryId, query.categoryId));
      }

      if (query?.legalEntityOwnerId) {
        conditions.push(eq(items.legalEntityOwnerId, query.legalEntityOwnerId));
      }

      if (query?.isSold !== undefined) {
        conditions.push(eq(items.isSold, query.isSold));
      }

      if (query?.isActive !== undefined) {
        conditions.push(eq(items.isActive, query.isActive));
      }

      if (query?.search) {
        const searchTerm = `%${query.search}%`;
        conditions.push(
          or(
            ilike(items.nameAr, searchTerm),
            ilike(items.nameEn, searchTerm),
            ilike(items.sku, searchTerm),
            ilike(items.barcode, searchTerm)
          )!
        );
      }

      const limit = query?.limit ?? 50;
      const offset = query?.offset ?? 0;

      const [totalCountResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(and(...conditions));

      const rows = await tx
        .select()
        .from(items)
        .where(and(...conditions))
        .orderBy(desc(items.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        total: totalCountResult?.count ?? 0,
        limit,
        offset,
        items: rows,
      };
    });
  }

  // ==================================================================
  // 4. Item Variants
  // ==================================================================

  async createVariant(context: TenantContext, dto: CreateItemVariantRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [item] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.id, dto.itemId)
          )
        )
        .limit(1);

      if (!item) {
        throw new NotFoundException(`Parent item '${dto.itemId}' not found`);
      }

      const [variant] = await tx
        .insert(itemVariants)
        .values({
          tenantId: context.tenantId,
          itemId: dto.itemId,
          variantCode: dto.variantCode,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          sku: dto.sku || null,
          barcode: dto.barcode || null,
          priceDelta: dto.priceDelta ?? '0.0000',
          costDelta: dto.costDelta ?? '0.0000',
          isActive: dto.isActive ?? true,
        })
        .returning();

      return variant;
    });
  }

  async getVariantsByItem(context: TenantContext, itemId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(itemVariants)
        .where(
          and(
            eq(itemVariants.tenantId, context.tenantId),
            eq(itemVariants.itemId, itemId)
          )
        )
        .orderBy(asc(itemVariants.variantCode));
    });
  }

  // ==================================================================
  // 5. Branch Pricing
  // ==================================================================

  async setBranchPrice(context: TenantContext, dto: SetBranchPriceRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Upsert branch item price
      const [existing] = await tx
        .select()
        .from(branchItemPrices)
        .where(
          and(
            eq(branchItemPrices.branchId, dto.branchId),
            eq(branchItemPrices.itemId, dto.itemId)
          )
        )
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(branchItemPrices)
          .set({
            price: dto.price,
            costOverride: dto.costOverride || null,
            isAvailable: dto.isAvailable ?? true,
            updatedAt: new Date(),
          })
          .where(eq(branchItemPrices.id, existing.id))
          .returning();

        return updated;
      }

      const [created] = await tx
        .insert(branchItemPrices)
        .values({
          tenantId: context.tenantId,
          branchId: dto.branchId,
          itemId: dto.itemId,
          price: dto.price,
          costOverride: dto.costOverride || null,
          isAvailable: dto.isAvailable ?? true,
        })
        .returning();

      return created;
    });
  }

  async getBranchPrices(context: TenantContext, branchId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(branchItemPrices)
        .where(
          and(
            eq(branchItemPrices.tenantId, context.tenantId),
            eq(branchItemPrices.branchId, branchId)
          )
        );
    });
  }

  async getEffectiveItemPrice(context: TenantContext, branchId: string, itemId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [item] = await tx
        .select({
          id: items.id,
          sku: items.sku,
          nameAr: items.nameAr,
          nameEn: items.nameEn,
          defaultPrice: items.defaultPrice,
          taxRate: items.taxRate,
          isActive: items.isActive,
        })
        .from(items)
        .where(
          and(
            eq(items.tenantId, context.tenantId),
            eq(items.id, itemId)
          )
        )
        .limit(1);

      if (!item) {
        throw new NotFoundException(`Item '${itemId}' not found`);
      }

      const [branchOverride] = await tx
        .select()
        .from(branchItemPrices)
        .where(
          and(
            eq(branchItemPrices.branchId, branchId),
            eq(branchItemPrices.itemId, itemId)
          )
        )
        .limit(1);

      const effectivePrice = branchOverride ? branchOverride.price : item.defaultPrice;
      const isAvailable = branchOverride ? branchOverride.isAvailable : item.isActive;

      return {
        itemId: item.id,
        sku: item.sku,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        effectivePrice,
        taxRate: item.taxRate,
        isBranchOverride: !!branchOverride,
        isAvailable,
      };
    });
  }

  // ==================================================================
  // 6. Suppliers
  // ==================================================================

  async createSupplier(context: TenantContext, dto: CreateSupplierRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.tenantId, context.tenantId),
            eq(suppliers.code, dto.code)
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(`Supplier code '${dto.code}' already exists`);
      }

      const [supplier] = await tx
        .insert(suppliers)
        .values({
          tenantId: context.tenantId,
          code: dto.code,
          name: dto.name,
          vatNumber: dto.vatNumber || null,
          contactPerson: dto.contactPerson || null,
          phone: dto.phone || null,
          email: dto.email || null,
          address: dto.address || null,
          isActive: dto.isActive ?? true,
        })
        .returning();

      return supplier;
    });
  }

  async getSuppliers(context: TenantContext) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.tenantId, context.tenantId))
        .orderBy(asc(suppliers.name));
    });
  }
}
