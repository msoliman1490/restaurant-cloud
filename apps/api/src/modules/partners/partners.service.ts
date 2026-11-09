import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  businessPartners,
  partnerRoles,
  partnerAddresses,
  partnerContacts,
  partnerCompanySettings,
  partnerBalances,
} from '@restaurant-cloud/database';
import {
  CreateBusinessPartnerRequest,
  UpdateBusinessPartnerRequest,
  CreatePartnerAddressRequest,
  CreatePartnerContactRequest,
  SetPartnerCompanySettingsRequest,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, or, ilike, desc } from 'drizzle-orm';

@Injectable()
export class PartnersService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Create a unified business partner with roles, verifying VAT/CRN uniqueness per tenant.
   */
  async createPartner(context: TenantContext, dto: CreateBusinessPartnerRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Uniqueness check for partnerNumber
      const [existingNum] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.partnerNumber, dto.partnerNumber)
          )
        )
        .limit(1);

      if (existingNum) {
        throw new ConflictException(`رقم الطرف التجاري '${dto.partnerNumber}' مسجل مسبقاً`);
      }

      // 2. Uniqueness check for Tax Identification Number (VAT/TRN)
      if (dto.taxIdentificationNumber) {
        const [existingVat] = await tx
          .select({ id: businessPartners.id, name: businessPartners.legalNameAr })
          .from(businessPartners)
          .where(
            and(
              eq(businessPartners.tenantId, context.tenantId),
              eq(businessPartners.taxIdentificationNumber, dto.taxIdentificationNumber)
            )
          )
          .limit(1);

        if (existingVat) {
          throw new ConflictException(
            `الرقم الضريبي '${dto.taxIdentificationNumber}' مسجل مسبقاً للطرف: ${existingVat.name}`
          );
        }
      }

      // 3. Uniqueness check for Commercial Registration Number (CRN)
      if (dto.commercialRegistrationNumber) {
        const [existingCrn] = await tx
          .select({ id: businessPartners.id, name: businessPartners.legalNameAr })
          .from(businessPartners)
          .where(
            and(
              eq(businessPartners.tenantId, context.tenantId),
              eq(businessPartners.commercialRegistrationNumber, dto.commercialRegistrationNumber)
            )
          )
          .limit(1);

        if (existingCrn) {
          throw new ConflictException(
            `رقم السجل التجاري '${dto.commercialRegistrationNumber}' مسجل مسبقاً للطرف: ${existingCrn.name}`
          );
        }
      }

      // 4. Insert Central Business Partner
      const [partner] = await tx
        .insert(businessPartners)
        .values({
          tenantId: context.tenantId,
          partnerNumber: dto.partnerNumber,
          partnerType: dto.partnerType,
          legalNameAr: dto.legalNameAr,
          legalNameEn: dto.legalNameEn || null,
          tradeNameAr: dto.tradeNameAr || null,
          tradeNameEn: dto.tradeNameEn || null,
          taxIdentificationNumber: dto.taxIdentificationNumber || null,
          commercialRegistrationNumber: dto.commercialRegistrationNumber || null,
          nationalIdOrIqama: dto.nationalIdOrIqama || null,
          primaryEmail: dto.primaryEmail || null,
          primaryPhone: dto.primaryPhone || null,
          website: dto.website || null,
          notes: dto.notes || null,
          createdBy: context.userId,
          updatedBy: context.userId,
        })
        .returning();

      if (!partner) throw new Error('فشل إنشاء سجل الطرف التجاري');

      // 5. Insert Roles
      for (const roleType of dto.roles) {
        await tx.insert(partnerRoles).values({
          tenantId: context.tenantId,
          partnerId: partner.id,
          roleType,
          status: 'ACTIVE',
        });
      }

      // 6. Audit Trail
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'BUSINESS_PARTNER_CREATED',
          entityType: 'BUSINESS_PARTNER',
          entityId: partner.id,
          afterState: { partnerNumber: partner.partnerNumber, roles: dto.roles },
        },
        tx
      );

      return partner;
    });
  }

  /**
   * Fetch Partner 360 Profile: details, roles, addresses, contacts, settings, and balances.
   */
  async getPartner(context: TenantContext, partnerId: string, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select()
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .limit(1);

      if (!partner) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const roles = await tx
        .select()
        .from(partnerRoles)
        .where(
          and(
            eq(partnerRoles.tenantId, context.tenantId),
            eq(partnerRoles.partnerId, partnerId)
          )
        );

      const addresses = await tx
        .select()
        .from(partnerAddresses)
        .where(
          and(
            eq(partnerAddresses.tenantId, context.tenantId),
            eq(partnerAddresses.partnerId, partnerId)
          )
        );

      const contacts = await tx
        .select()
        .from(partnerContacts)
        .where(
          and(
            eq(partnerContacts.tenantId, context.tenantId),
            eq(partnerContacts.partnerId, partnerId)
          )
        );

      const settingsConditions = [
        eq(partnerCompanySettings.tenantId, context.tenantId),
        eq(partnerCompanySettings.partnerId, partnerId),
      ];
      if (legalEntityId) {
        settingsConditions.push(eq(partnerCompanySettings.legalEntityId, legalEntityId));
      }
      const settings = await tx
        .select()
        .from(partnerCompanySettings)
        .where(and(...settingsConditions));

      const balanceConditions = [
        eq(partnerBalances.tenantId, context.tenantId),
        eq(partnerBalances.partnerId, partnerId),
      ];
      if (legalEntityId) {
        balanceConditions.push(eq(partnerBalances.legalEntityId, legalEntityId));
      }
      const balances = await tx
        .select()
        .from(partnerBalances)
        .where(and(...balanceConditions));

      return {
        partner,
        roles: roles.map((r) => r.roleType),
        addresses,
        contacts,
        companySettings: settings,
        balances,
      };
    });
  }

  /**
   * List Partners with search and role filtering.
   */
  async listPartners(
    context: TenantContext,
    query: { role?: string; search?: string; limit?: number; offset?: number }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const conditions = [eq(businessPartners.tenantId, context.tenantId)];

      if (query.search) {
        conditions.push(
          or(
            ilike(businessPartners.legalNameAr, `%${query.search}%`),
            ilike(businessPartners.partnerNumber, `%${query.search}%`),
            ilike(businessPartners.taxIdentificationNumber, `%${query.search}%`),
            ilike(businessPartners.commercialRegistrationNumber, `%${query.search}%`)
          )!
        );
      }

      if (query.role) {
        const matchingPartners = await tx
          .select({ partnerId: partnerRoles.partnerId })
          .from(partnerRoles)
          .where(
            and(
              eq(partnerRoles.tenantId, context.tenantId),
              eq(partnerRoles.roleType, query.role as any)
            )
          );
        const pIds = matchingPartners.map((m) => m.partnerId);
        if (pIds.length === 0) {
          return { items: [], total: 0 };
        }
        conditions.push(sql`${businessPartners.id} IN ${pIds}`);
      }

      const items = await tx
        .select()
        .from(businessPartners)
        .where(and(...conditions))
        .orderBy(desc(businessPartners.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRes] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(businessPartners)
        .where(and(...conditions));

      return {
        items,
        total: Number(totalRes?.count || 0),
      };
    });
  }

  /**
   * Add Address (e.g. Saudi National Address for ZATCA B2B).
   */
  async addAddress(context: TenantContext, partnerId: string, dto: CreatePartnerAddressRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .limit(1);

      if (!partner) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const [addr] = await tx
        .insert(partnerAddresses)
        .values({
          tenantId: context.tenantId,
          partnerId,
          addressType: dto.addressType,
          buildingNumber: dto.buildingNumber,
          streetName: dto.streetName,
          districtName: dto.districtName,
          city: dto.city,
          postalCode: dto.postalCode,
          additionalNumber: dto.additionalNumber || null,
          countryCode: dto.countryCode || 'SA',
          shortAddress: dto.shortAddress || null,
          isPrimary: dto.isPrimary || false,
        })
        .returning();

      return addr;
    });
  }

  /**
   * Add Contact person.
   */
  async addContact(context: TenantContext, partnerId: string, dto: CreatePartnerContactRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .limit(1);

      if (!partner) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const [contact] = await tx
        .insert(partnerContacts)
        .values({
          tenantId: context.tenantId,
          partnerId,
          name: dto.name,
          jobTitle: dto.jobTitle || null,
          email: dto.email || null,
          phone: dto.phone || null,
          isAuthorizedSignatory: dto.isAuthorizedSignatory || false,
          isPrimary: dto.isPrimary || false,
        })
        .returning();

      return contact;
    });
  }

  /**
   * Upsert Company Settings (credit limit, payment terms, control accounts).
   */
  async setCompanySettings(
    context: TenantContext,
    partnerId: string,
    dto: SetPartnerCompanySettingsRequest
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .limit(1);

      if (!partner) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const [existing] = await tx
        .select({ id: partnerCompanySettings.id })
        .from(partnerCompanySettings)
        .where(
          and(
            eq(partnerCompanySettings.tenantId, context.tenantId),
            eq(partnerCompanySettings.legalEntityId, dto.legalEntityId),
            eq(partnerCompanySettings.partnerId, partnerId)
          )
        )
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(partnerCompanySettings)
          .set({
            defaultCurrency: dto.defaultCurrency,
            paymentTermsDays: dto.paymentTermsDays,
            creditLimit: dto.creditLimit,
            isCreditBlocked: dto.isCreditBlocked,
            priceTolerancePct: dto.priceTolerancePct,
            arControlAccountId: dto.arControlAccountId || null,
            apControlAccountId: dto.apControlAccountId || null,
            customDiscountPct: dto.customDiscountPct,
            priceTierId: dto.priceTierId || null,
            taxExempt: dto.taxExempt,
            taxExemptionReason: dto.taxExemptionReason || null,
            updatedAt: new Date(),
          })
          .where(eq(partnerCompanySettings.id, existing.id))
          .returning();
        return updated;
      } else {
        const [created] = await tx
          .insert(partnerCompanySettings)
          .values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            partnerId,
            defaultCurrency: dto.defaultCurrency,
            paymentTermsDays: dto.paymentTermsDays,
            creditLimit: dto.creditLimit,
            isCreditBlocked: dto.isCreditBlocked,
            priceTolerancePct: dto.priceTolerancePct,
            arControlAccountId: dto.arControlAccountId || null,
            apControlAccountId: dto.apControlAccountId || null,
            customDiscountPct: dto.customDiscountPct,
            priceTierId: dto.priceTierId || null,
            taxExempt: dto.taxExempt,
            taxExemptionReason: dto.taxExemptionReason || null,
          })
          .returning();
        return created;
      }
    });
  }

  /**
   * Toggle partner hold status.
   */
  async toggleHold(context: TenantContext, partnerId: string, isHold: boolean, reason?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .limit(1);

      if (!partner) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const [updated] = await tx
        .update(businessPartners)
        .set({
          isOnHold: isHold,
          holdReason: isHold ? reason || 'تم إيقاف التعامل مؤقتاً' : null,
          updatedAt: new Date(),
          updatedBy: context.userId,
        })
        .where(
          and(
            eq(businessPartners.tenantId, context.tenantId),
            eq(businessPartners.id, partnerId)
          )
        )
        .returning();

      return updated;
    });
  }
}
