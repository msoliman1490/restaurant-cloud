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
  arInvoices,
  apInvoices,
} from '@restaurant-cloud/database';
import {
  CreateBusinessPartnerRequest,
  UpdateBusinessPartnerRequest,
  CreatePartnerAddressRequest,
  CreatePartnerContactRequest,
  SetPartnerCompanySettingsRequest,
  NationalAddressInput,
} from '@restaurant-cloud/shared-contracts';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, or, ilike, desc, asc, inArray } from 'drizzle-orm';

@Injectable()
export class PartnersService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  private toNationalAddressDto(row: any) {
    if (!row) return null;
    return {
      shortAddress: row.shortAddress || '',
      buildingNumber: row.buildingNumber || '',
      streetName: row.streetName || '',
      district: row.districtName || '',
      city: row.city || '',
      postalCode: row.postalCode || '',
      additionalNumber: row.additionalNumber || '',
      unitNumber: row.unitNumber || '',
      country: row.country || 'المملكة العربية السعودية',
    };
  }

  private hasNationalAddressData(addr?: NationalAddressInput | null): boolean {
    if (!addr) return false;
    return Boolean(
      addr.shortAddress?.trim() ||
        addr.buildingNumber?.trim() ||
        addr.streetName?.trim() ||
        addr.district?.trim() ||
        addr.city?.trim() ||
        addr.postalCode?.trim() ||
        addr.additionalNumber?.trim() ||
        addr.unitNumber?.trim()
    );
  }

  private async upsertNationalAddressInTx(
    tx: any,
    tenantId: string,
    partnerId: string,
    addr?: NationalAddressInput | null
  ) {
    if (!addr || !this.hasNationalAddressData(addr)) {
      return null;
    }

    const [existing] = await tx
      .select()
      .from(partnerAddresses)
      .where(
        and(
          eq(partnerAddresses.tenantId, tenantId),
          eq(partnerAddresses.partnerId, partnerId),
          eq(partnerAddresses.addressType, 'NATIONAL_ADDRESS')
        )
      )
      .limit(1);

    const payload = {
      shortAddress: addr.shortAddress?.trim() ? addr.shortAddress.trim().toUpperCase() : null,
      buildingNumber: addr.buildingNumber?.trim() || null,
      streetName: addr.streetName?.trim() || null,
      districtName: addr.district?.trim() || null,
      city: addr.city?.trim() || null,
      postalCode: addr.postalCode?.trim() || null,
      additionalNumber: addr.additionalNumber?.trim() || null,
      unitNumber: addr.unitNumber?.trim() || null,
      country: addr.country?.trim() || 'المملكة العربية السعودية',
      countryCode: 'SA',
      isPrimary: true,
    };

    if (existing) {
      const [updated] = await tx
        .update(partnerAddresses)
        .set(payload)
        .where(eq(partnerAddresses.id, existing.id))
        .returning();
      return this.toNationalAddressDto(updated);
    }

    const [inserted] = await tx
      .insert(partnerAddresses)
      .values({
        tenantId,
        partnerId,
        addressType: 'NATIONAL_ADDRESS',
        ...payload,
      })
      .returning();
    return this.toNationalAddressDto(inserted);
  }

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

      const savedAddress = await this.upsertNationalAddressInTx(
        tx,
        context.tenantId,
        partner.id,
        dto.nationalAddress
      );

      // 6. Audit Trail
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'BUSINESS_PARTNER_CREATED',
          entityType: 'BUSINESS_PARTNER',
          entityId: partner.id,
          afterState: { partnerNumber: partner.partnerNumber, roles: dto.roles, hasNationalAddress: Boolean(savedAddress) },
        },
        tx
      );

      return {
        ...partner,
        nationalAddress: savedAddress,
      };
    });
  }

  /**
   * Update a unified business partner (Customer / Supplier) and its National Address.
   */
  async updatePartner(context: TenantContext, partnerId: string, dto: UpdateBusinessPartnerRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(businessPartners)
        .where(and(eq(businessPartners.tenantId, context.tenantId), eq(businessPartners.id, partnerId)))
        .limit(1);

      if (!existing) {
        throw new NotFoundException(`الطرف التجاري غير موجود: ${partnerId}`);
      }

      const updateFields: Record<string, any> = {
        updatedAt: new Date(),
        updatedBy: context.userId,
      };
      if (dto.partnerType !== undefined) updateFields.partnerType = dto.partnerType;
      if (dto.legalNameAr !== undefined) updateFields.legalNameAr = dto.legalNameAr;
      if (dto.legalNameEn !== undefined) updateFields.legalNameEn = dto.legalNameEn;
      if (dto.tradeNameAr !== undefined) updateFields.tradeNameAr = dto.tradeNameAr;
      if (dto.tradeNameEn !== undefined) updateFields.tradeNameEn = dto.tradeNameEn;
      if (dto.taxIdentificationNumber !== undefined) updateFields.taxIdentificationNumber = dto.taxIdentificationNumber;
      if (dto.commercialRegistrationNumber !== undefined) updateFields.commercialRegistrationNumber = dto.commercialRegistrationNumber;
      if (dto.nationalIdOrIqama !== undefined) updateFields.nationalIdOrIqama = dto.nationalIdOrIqama;
      if (dto.primaryEmail !== undefined) updateFields.primaryEmail = dto.primaryEmail;
      if (dto.primaryPhone !== undefined) updateFields.primaryPhone = dto.primaryPhone;
      if (dto.website !== undefined) updateFields.website = dto.website;
      if (dto.notes !== undefined) updateFields.notes = dto.notes;

      const [updated] = await tx
        .update(businessPartners)
        .set(updateFields)
        .where(eq(businessPartners.id, partnerId))
        .returning();

      let savedAddress: any = undefined;
      if (dto.nationalAddress !== undefined) {
        savedAddress = await this.upsertNationalAddressInTx(
          tx,
          context.tenantId,
          partnerId,
          dto.nationalAddress
        );
      } else {
        const [addrRow] = await tx
          .select()
          .from(partnerAddresses)
          .where(
            and(
              eq(partnerAddresses.tenantId, context.tenantId),
              eq(partnerAddresses.partnerId, partnerId),
              eq(partnerAddresses.addressType, 'NATIONAL_ADDRESS')
            )
          )
          .limit(1);
        savedAddress = this.toNationalAddressDto(addrRow);
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'BUSINESS_PARTNER_UPDATED',
          entityType: 'BUSINESS_PARTNER',
          entityId: partnerId,
          afterState: { updateFields, hasNationalAddress: Boolean(savedAddress) },
        },
        tx
      );

      return {
        ...updated,
        nationalAddress: savedAddress,
      };
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

      const primaryNatAddr =
        addresses.find((a) => a.addressType === 'NATIONAL_ADDRESS') || addresses[0] || null;

      return {
        partner,
        roles: roles.map((r) => r.roleType),
        nationalAddress: this.toNationalAddressDto(primaryNatAddr),
        addresses,
        contacts,
        companySettings: settings,
        balances,
      };
    });
  }

  /**
   * List Partners with server-side pagination, search, role/status filtering, sorting & batched AR/AP metrics.
   */
  async listPartners(
    context: TenantContext,
    query: {
      role?: string;
      search?: string;
      status?: string;
      sortBy?: string;
      sortDir?: string;
      page?: number;
      limit?: number;
      offset?: number;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const page = Math.max(1, query.page || 1);
      const offset = query.offset !== undefined ? query.offset : (page - 1) * limit;

      const conditions = [eq(businessPartners.tenantId, context.tenantId)];

      if (query.status === 'ACTIVE') {
        conditions.push(eq(businessPartners.isActive, true));
      } else if (query.status === 'INACTIVE') {
        conditions.push(eq(businessPartners.isActive, false));
      }

      if (query.search) {
        const term = `%${query.search.trim()}%`;
        conditions.push(
          or(
            ilike(businessPartners.legalNameAr, term),
            ilike(businessPartners.legalNameEn, term),
            ilike(businessPartners.tradeNameAr, term),
            ilike(businessPartners.partnerNumber, term),
            ilike(businessPartners.primaryPhone, term),
            ilike(businessPartners.taxIdentificationNumber, term),
            ilike(businessPartners.commercialRegistrationNumber, term)
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
          return { items: [], total: 0, page, limit, totalPages: 0 };
        }
        conditions.push(inArray(businessPartners.id, pIds));
      }

      const dirFn = query.sortDir === 'asc' ? asc : desc;
      const orderExpr =
        query.sortBy === 'legalNameAr'
          ? dirFn(businessPartners.legalNameAr)
          : query.sortBy === 'partnerNumber'
            ? dirFn(businessPartners.partnerNumber)
            : dirFn(businessPartners.createdAt);

      const rawItems = await tx
        .select()
        .from(businessPartners)
        .where(and(...conditions))
        .orderBy(orderExpr)
        .limit(limit)
        .offset(offset);

      const [totalRes] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(businessPartners)
        .where(and(...conditions));

      const total = Number(totalRes?.count || 0);
      if (rawItems.length === 0) {
        return { items: [], total, page, limit, totalPages: Math.ceil(total / limit) };
      }

      const ids = rawItems.map((i) => i.id);

      const [rolesRows, balRows, arAggRows, apAggRows] = await Promise.all([
        tx
          .select({ partnerId: partnerRoles.partnerId, roleType: partnerRoles.roleType })
          .from(partnerRoles)
          .where(and(eq(partnerRoles.tenantId, context.tenantId), inArray(partnerRoles.partnerId, ids))),
        tx
          .select({
            partnerId: partnerBalances.partnerId,
            arBalance: partnerBalances.customerBalance,
            apBalance: partnerBalances.vendorBalance,
          })
          .from(partnerBalances)
          .where(and(eq(partnerBalances.tenantId, context.tenantId), inArray(partnerBalances.partnerId, ids))),
        tx
          .select({
            partnerId: arInvoices.partnerId,
            totalSales: sql<string>`coalesce(sum(${arInvoices.grandTotal}), 0)::text`,
            lastSaleAt: sql<string>`max(${arInvoices.issueDate})::text`,
          })
          .from(arInvoices)
          .where(and(eq(arInvoices.tenantId, context.tenantId), inArray(arInvoices.partnerId, ids)))
          .groupBy(arInvoices.partnerId),
        tx
          .select({
            partnerId: apInvoices.partnerId,
            totalPurchases: sql<string>`coalesce(sum(${apInvoices.grandTotal}), 0)::text`,
            lastInvoiceAt: sql<string>`max(${apInvoices.invoiceDate})::text`,
          })
          .from(apInvoices)
          .where(and(eq(apInvoices.tenantId, context.tenantId), inArray(apInvoices.partnerId, ids)))
          .groupBy(apInvoices.partnerId),
      ]);

      const rolesMap = new Map<string, string[]>();
      for (const r of rolesRows) {
        const list = rolesMap.get(r.partnerId) ?? [];
        list.push(r.roleType);
        rolesMap.set(r.partnerId, list);
      }

      const balMap = new Map<string, { arBalance: number; apBalance: number }>();
      for (const b of balRows) {
        const prev = balMap.get(b.partnerId) ?? { arBalance: 0, apBalance: 0 };
        prev.arBalance += Number(b.arBalance || 0);
        prev.apBalance += Number(b.apBalance || 0);
        balMap.set(b.partnerId, prev);
      }

      const arMap = new Map(arAggRows.map((a) => [a.partnerId, a]));
      const apMap = new Map(apAggRows.map((a) => [a.partnerId, a]));

      const addrRows =
        ids.length > 0
          ? await tx
              .select()
              .from(partnerAddresses)
              .where(
                and(
                  eq(partnerAddresses.tenantId, context.tenantId),
                  inArray(partnerAddresses.partnerId, ids),
                  eq(partnerAddresses.addressType, 'NATIONAL_ADDRESS')
                )
              )
          : [];
      const addrMap = new Map(addrRows.map((a) => [a.partnerId, this.toNationalAddressDto(a)]));

      const items = rawItems.map((item) => {
        const bal = balMap.get(item.id) ?? { arBalance: 0, apBalance: 0 };
        const arAgg = arMap.get(item.id);
        const apAgg = apMap.get(item.id);
        return {
          ...item,
          roles: rolesMap.get(item.id) ?? [],
          nationalAddress: addrMap.get(item.id) ?? null,
          arBalance: bal.arBalance,
          apBalance: bal.apBalance,
          totalSales: Number(arAgg?.totalSales || 0),
          lastSaleAt: arAgg?.lastSaleAt || null,
          totalPurchases: Number(apAgg?.totalPurchases || 0),
          lastInvoiceAt: apAgg?.lastInvoiceAt || null,
        };
      });

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Activate an additional role (e.g. CUSTOMER or VENDOR) on an existing Business Partner without duplication.
   */
  async addPartnerRole(context: TenantContext, partnerId: string, roleType: 'CUSTOMER' | 'VENDOR') {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select()
        .from(businessPartners)
        .where(and(eq(businessPartners.tenantId, context.tenantId), eq(businessPartners.id, partnerId)))
        .limit(1);
      if (!partner) {
        throw new NotFoundException('الطرف التجاري غير موجود');
      }

      const [existingRole] = await tx
        .select()
        .from(partnerRoles)
        .where(
          and(
            eq(partnerRoles.tenantId, context.tenantId),
            eq(partnerRoles.partnerId, partnerId),
            eq(partnerRoles.roleType, roleType)
          )
        )
        .limit(1);

      if (existingRole) {
        return existingRole;
      }

      const [created] = await tx
        .insert(partnerRoles)
        .values({
          tenantId: context.tenantId,
          partnerId,
          roleType,
          status: 'ACTIVE',
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PARTNER_ROLE_ADDED',
          entityType: 'BUSINESS_PARTNER',
          entityId: partnerId,
          afterState: { roleType },
        },
        tx
      );

      return created;
    });
  }

  /**
   * Get Partner Statement of Account (كشف حساب العميل / المورد) from AR/AP subledger invoices.
   */
  async getPartnerStatement(context: TenantContext, partnerId: string, role?: 'CUSTOMER' | 'VENDOR') {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [partner] = await tx
        .select()
        .from(businessPartners)
        .where(and(eq(businessPartners.tenantId, context.tenantId), eq(businessPartners.id, partnerId)))
        .limit(1);
      if (!partner) {
        throw new NotFoundException('الطرف التجاري غير موجود');
      }

      const [arRows, apRows, balances] = await Promise.all([
        role === 'VENDOR'
          ? Promise.resolve([])
          : tx
              .select({
                id: arInvoices.id,
                invoiceNumber: arInvoices.invoiceNumber,
                invoiceDate: arInvoices.issueDate,
                grandTotal: arInvoices.grandTotal,
                balanceDue: arInvoices.remainingAmount,
                status: arInvoices.status,
              })
              .from(arInvoices)
              .where(and(eq(arInvoices.tenantId, context.tenantId), eq(arInvoices.partnerId, partnerId)))
              .orderBy(desc(arInvoices.issueDate)),
        role === 'CUSTOMER'
          ? Promise.resolve([])
          : tx
              .select({
                id: apInvoices.id,
                invoiceNumber: apInvoices.internalNumber,
                invoiceDate: apInvoices.invoiceDate,
                grandTotal: apInvoices.grandTotal,
                balanceDue: apInvoices.remainingAmount,
                status: apInvoices.status,
              })
              .from(apInvoices)
              .where(and(eq(apInvoices.tenantId, context.tenantId), eq(apInvoices.partnerId, partnerId)))
              .orderBy(desc(apInvoices.invoiceDate)),
        tx
          .select()
          .from(partnerBalances)
          .where(and(eq(partnerBalances.tenantId, context.tenantId), eq(partnerBalances.partnerId, partnerId))),
      ]);

      return {
        partner,
        balances,
        arInvoices: arRows,
        apInvoices: apRows,
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
