import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../../modules/audit/audit.service';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import {
  orderLines,
  inventoryMovements,
  categories,
  items,
  unitsOfMeasure,
  uomConversions,
  branches,
  warehouses,
  salesOrders,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';

export interface UserScopeRecord {
  id: string;
  membershipId: string;
  scopeType: 'GLOBAL' | 'LEGAL_ENTITY' | 'BRANCH' | string;
  scopeEntityId?: string | null;
}

export type StandardOperationAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'upload'
  | 'replace'
  | 'export'
  | 'change_price'
  | 'change_cost'
  | 'approve'
  | 'cancel';

@Injectable()
export class OperationsFrameworkService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Verify User Scoping (Global / Legal Entity / Branch)
   * Rule: If user is not superadmin and has empty scopes, access is strictly rejected.
   * Absence of branch scope NEVER grants accidental access to all branches.
   */
  verifyScope(
    context: TenantContext,
    userScopes: UserScopeRecord[] | undefined,
    target: { legalEntityId?: string; branchId?: string }
  ): void {
    // 1. Superadmin wildcard bypass
    if (context.scopes && context.scopes.includes('*')) {
      return;
    }

    // 2. Strict empty check: empty scopes array cannot access scoped resources
    if (!userScopes || userScopes.length === 0) {
      throw new ForbiddenException(
        'المستخدم ليس لديه نطاق صلاحيات محدد في هذا المستأجر. يرجى مراجعة مدير النظام لتعيين فرع أو شركة.'
      );
    }

    // 3. Global scope allows all branches & entities within this tenant
    const hasGlobal = userScopes.some((s) => s.scopeType === 'GLOBAL');
    if (hasGlobal) {
      return;
    }

    // 4. Branch Scoping Check
    if (target.branchId) {
      const allowedBranch = userScopes.some(
        (s) => s.scopeType === 'BRANCH' && s.scopeEntityId === target.branchId
      );
      if (!allowedBranch) {
        throw new ForbiddenException(
          `العملية خارج نطاق الفرع المصرح لك بالوصول إليه (${target.branchId}).`
        );
      }
    }

    // 5. Legal Entity Scoping Check
    if (target.legalEntityId) {
      const allowedEntity = userScopes.some(
        (s) => s.scopeType === 'LEGAL_ENTITY' && s.scopeEntityId === target.legalEntityId
      );
      if (!allowedEntity) {
        throw new ForbiddenException(
          `العملية خارج نطاق الشركة القانونية المصرح لك بالوصول إليها (${target.legalEntityId}).`
        );
      }
    }
  }

  /**
   * Universal Reference Integrity Verifier
   * Blocks physical deletion if the entity is referenced in historical documents across any sector.
   */
  async assertCanDelete(
    context: TenantContext,
    entityType: string,
    entityId: string
  ): Promise<void> {
    await this.dbService.withTenantContext(context, async (tx) => {
      let referenceCount = 0;
      let referenceDescription = '';

      switch (entityType.toLowerCase()) {
        case 'item': {
          // Check sales order lines
          const [salesUsage] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(orderLines)
            .where(eq(orderLines.itemId, entityId));

          referenceCount += salesUsage?.count ?? 0;

          // Check inventory movements
          const [invUsage] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(inventoryMovements)
            .where(
              and(
                eq(inventoryMovements.tenantId, context.tenantId),
                eq(inventoryMovements.itemId, entityId)
              )
            );

          referenceCount += invUsage?.count ?? 0;

          // Dynamic check for other sectors if tables exist
          const dynamicCheck = async (tableName: string, colName: string) => {
            try {
              const res = await tx.execute(
                sql`SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName}`
              );
              if (res[0] && (res[0] as any).count > 0) {
                const countRes = await tx.execute(
                  sql.raw(`SELECT count(*)::int as count FROM public.${tableName} WHERE ${colName} = '${entityId}'`)
                );
                return (countRes[0] as any)?.count ?? 0;
              }
            } catch {
              return 0;
            }
            return 0;
          };

          referenceCount += await dynamicCheck('purchase_order_lines', 'item_id');
          referenceCount += await dynamicCheck('goods_receipt_lines', 'item_id');
          referenceCount += await dynamicCheck('stock_transfer_lines', 'item_id');
          referenceCount += await dynamicCheck('stock_adjustment_lines', 'item_id');
          referenceCount += await dynamicCheck('recipes', 'output_item_id');
          referenceCount += await dynamicCheck('recipe_ingredients', 'ingredient_item_id');

          referenceDescription = 'حركات بيع أو مشتريات أو مخزون أو وصفات تصنيع';
          break;
        }

        case 'category': {
          // Child categories check
          const [childCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(categories)
            .where(
              and(
                eq(categories.tenantId, context.tenantId),
                eq(categories.parentId, entityId)
              )
            );

          // Items assigned check
          const [itemCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(items)
            .where(
              and(
                eq(items.tenantId, context.tenantId),
                eq(items.categoryId, entityId)
              )
            );

          referenceCount = (childCount?.count ?? 0) + (itemCount?.count ?? 0);
          referenceDescription = 'تصنيفات فرعية أو أصناف تابعة له';
          break;
        }

        case 'uom': {
          // Items using this UoM
          const [itemUsage] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(items)
            .where(
              and(
                eq(items.tenantId, context.tenantId),
                eq(items.baseUomId, entityId)
              )
            );

          // Conversions using this UoM
          const [convUsage] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(uomConversions)
            .where(
              and(
                eq(uomConversions.tenantId, context.tenantId),
                sql`${uomConversions.fromUomId} = ${entityId} OR ${uomConversions.toUomId} = ${entityId}`
              )
            );

          referenceCount = (itemUsage?.count ?? 0) + (convUsage?.count ?? 0);
          referenceDescription = 'أصناف أو معادلات تحويل وحدات قياس';
          break;
        }

        case 'branch': {
          const [whCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(warehouses)
            .where(
              and(
                eq(warehouses.tenantId, context.tenantId),
                eq(warehouses.branchId, entityId)
              )
            );

          const [salesCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(salesOrders)
            .where(
              and(
                eq(salesOrders.tenantId, context.tenantId),
                eq(salesOrders.branchId, entityId)
              )
            );

          referenceCount = (whCount?.count ?? 0) + (salesCount?.count ?? 0);
          referenceDescription = 'مستودعات أو مبيعات مرتبطة بالفرع';
          break;
        }
      }

      if (referenceCount > 0) {
        const entityLabel =
          entityType.toLowerCase() === 'item'
            ? 'الصنف'
            : entityType.toLowerCase() === 'category'
            ? 'التصنيف'
            : `هذا السجل (${entityType})`;

        throw new BadRequestException(
          `لا يمكن حذف ${entityLabel} لوجود ${referenceCount} معاملة وسجل تاريخي مرتبط به (${referenceDescription}). يُرجى أرشفة الصنف بدلاً من الحذف لحماية سلامة القيود والبيانات المالية والتشغيلية.`
        );
      }
    });
  }

  /**
   * Enforce Document Locking & Historical Immutability
   */
  assertDocumentNotLocked(entityType: string, status: string, action: string = 'update'): void {
    const lockedStatuses = new Set(['POSTED', 'COMPLETED', 'CLOSED', 'ARCHIVED', 'CANCELLED']);
    if (lockedStatuses.has(status.toUpperCase())) {
      throw new BadRequestException(
        `لا يمكن تنفيذ إجراء '${action}' على مستند '${entityType}' في حالة '${status}'. المستندات المرحلة والنهائية محمية وغير قابلة للتعديل أو الحذف لضمان سلامة السجلات المالية التاريخية.`
      );
    }
  }
}
