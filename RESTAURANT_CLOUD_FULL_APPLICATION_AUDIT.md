# Restaurant Cloud ERP/POS — Full Application Audit & Completion Roadmap

**تاريخ التدقيق:** 2026-11-15  
**نطاق المراجعة:** مراجعة شاملة للتطبيق بالكامل (`apps/web`, `apps/api`, `packages/database`, `packages/shared-contracts`, `packages/domain-kernel`) على بيئة **Staging** (دون أي تعديل على الكود أو قاعدة البيانات أو بيئة Production، ودون تنفيذ Payroll أو ZATCA Live Simulation OTP).

---

## 1. Executive Summary

نظام **Restaurant Cloud ERP/POS** مبني بمعمارية **Modular Monolith** قوية في طبقة البيانات والمحركات المحاسبية والمخزنية الخلفية (`126` جدولًا في المخطط / `124` جدولًا تشغيليًا على Staging + `28` ترحيل Drizzle + `100%` تغطية `RLS` و`FORCE RLS` على جداول `tenant_id`).  
مع ذلك، **التطبيق غير جاهز حاليًا للإطلاق التجاري الكامل في السوق السعودي** بسبب فجوات حرجة في **الربط الفعلي بين Frontend وBackend**، وغياب وظائف تشغيلية أساسية في نقطة البيع، وبعض الثغرات الأمنية والتزامنية في الخدمات الخلفية.

### أبرز النتائج الحرجة (Critical & High)
1. **خلل Double-Unwrapping في Frontend (Critical):** دالة `apiClient.request` (`apps/web/src/api/client.ts:162`) تفك تغليف `json.data` تلقائيًا، لكن **8 شاشات رئيسية** (`PosView`, `CatalogView`, `InventoryView`, `DiningView`, `PurchasingView`, `ProductionView`, `HrEmployeesView`, `TransfersView`) تقرأ `.data` مرة ثانية (`res?.data`) فتستلم `undefined` وتعود تلقائيًا إلى بيانات وهمية (`SAMPLE_PRODUCTS`, `INITIAL_WAREHOUSES`, `INITIAL_POS`) أو قوائم فارغة.
2. **نقاط نهاية مكسورة ومعالجة أخطاء خاطئة (High):**
   - `PosShiftClosingView.tsx:150` يستدعي `GET /accounting/cash-vaults` (404) بدلًا من `@Get('vaults')` في `accounting.controller.ts:246`.
   - شاشات `DeliveryView`, `SettlementsView`, `TransfersView` تقرأ `err?.response?.data?.message` (أسلوب Axios) على عميل `fetch` مخصص (`ApiError.message`) فتضيع رسائل التحقق الفعلية.
3. **غياب Offline POS ومزامنته وطباعة الإيصالات (Critical):** جدول `offline_quota_leases` موجود في قاعدة البيانات (`finance.ts`) دون أي تنفيذ Backend أو Frontend؛ ولا توجد آلية `window.print()` / Thermal Receipt أو Queue محلي في `PosView`.
4. **تجاوز `InventoryService` و`PostingEngine` في `ProductionService` و`SalesService` (Critical):**
   - `production.service.ts` يعدّل `inventoryBalances` و`inventoryCostLayers` مباشرة دون `InventoryService` أو `.for('update')`، ويعتمد على أكواد حسابات ثابتة (`'1300'/'1050'`, `'1200'/'1040'`) بدل `DefaultAccountMappingKey` مما يؤدي لتخطي القيد المحاسبي بصمت إذا تغيرت الأكواد.
   - `sales.service.ts`, `delivery.service.ts`, `hr.service.ts`, `ar-subledger.service.ts`, `ap-subledger.service.ts` تفتقر إلى `.for('update')` عند تحديث أرصدة الخزائن أو الشركاء أو الدفعات.
5. **ثغرات أمان ومدخلات في Backend (Critical/High):**
   - `operations-framework.service.ts:155-157` يبني استعلام `sql.raw` مدمجًا نصيًا (`WHERE ${colName} = '${entityId}'`).
   - `media.service.ts:20` يسمح برفع `image/svg+xml` ويعرضه `media.controller.ts:132-145` مباشرة دون `Content-Disposition: attachment` أو تعقيم XSS.
   - غياب Rate Limiting، وغياب Zod validation في `delivery.controller.ts` و`zatca.controller.ts` وبعض مسارات `dining/tenant/accounting/sales`، وغياب `@RequirePermissions` عن عشرات مسارات `GET`، وعدم تطابق فاصل الصلاحيات في `delivery.controller.ts` (`:` بدل `.`).
6. **مرتجعات المبيعات غير مكشوفة في API (High):** `refundSalesOrder` منفّذة في `sales.service.ts:1686-1982` لكن لا يوجد لها Route في `sales.controller.ts`.
7. **تجربة المستخدم UI/UX (High):** الواجهة عربية فقط (RTL hardcoded) رغم وجود خيار `primaryLocale` في `SettingsView`، والـ `Sidebar` بعرض ثابت `w-64` غير متجاوب مع التابلت والجوال، ولا يوجد تصدير CSV/PDF أو بحث/ترقيم Server-side في عدة شاشات.

---

## 2. Architecture Overview

- **Backend (`apps/api`):** NestJS + Fastify، مع 16 موديولًا: `accounting`, `audit`, `catalog`, `delivery`, `dining`, `hr`, `iam`, `inventory`, `media`, `partners`, `production`, `purchasing`, `sales`, `settlements`, `tenant`, `zatca`.
- **Database (`packages/database`):** PostgreSQL 16 + Drizzle ORM (`16` ملف schema تضم `126` جدولًا)، مع `28` ملف هجرة (`0000`–`0027`) مطبقة وموثقة في `__drizzle_migrations`، و`100%` تفعيل `RLS` و`FORCE RLS` على جداول `tenant_id` (`124` جدولًا فعليًا و`420` فهرسًا على Staging).
- **Frontend (`apps/web`):** React + Vite + TailwindCSS، `28` شاشة ومكونًا تحت `apps/web/src/components/` متصلة عبر `apiClient` (`apps/web/src/api/client.ts`).
- **Shared Packages:** `@restaurant-cloud/domain-kernel` (ثوابت، Enums، أنواع السياق) و`@restaurant-cloud/shared-contracts` (مخططات Zod).

---

## 3. Complete Module Inventory & Completion Percentages

### طريقة حساب نسبة الاكتمال
لكل موديول، تم جرد الوظائف المطلوبة فعليًا ضمن نطاق المنتج (مع استثناء Payroll وحساب ZATCA Live Simulation OTP كمسار منفصل)، واحتساب النسبة كالتالي:
$$\text{Completion \%} = \frac{\sum (\text{COMPLETE} = 1.0,\ \text{PARTIAL} = 0.5,\ \text{MISSING/BROKEN/MOCKED/UNVERIFIED} = 0.0)}{\text{Total In-Scope Features}} \times 100$$

| # | المجموعة / الموديول | عدد الوظائف | COMPLETE | PARTIAL | MISSING | BROKEN/MOCKED | نسبة الاكتمال | الحالة العامة |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | إدارة النظام والشركات (`tenant`, `iam`) | 10 | 7 | 3 | 0 | 0 | **85%** | قوي في Backend؛ فجوات validation و`GET` RBAC وتبديل اللغة |
| 2 | المبيعات ونقاط البيع (`sales`) | 12 | 4 | 3 | 3 | 2 | **46%** | متين في Shift/Order Backend؛ مكسور في UI (`PosView`/Shift) وغياب Offline/Print/Refund route/Promotions |
| 3 | المطاعم والمطبخ والإنتاج (`dining`, `production`) | 11 | 4 | 4 | 1 | 2 | **55%** | Backend Dining/Production جيد مع عيوب ربط GL/Inventory في Production وكسر `.data` في UI |
| 4 | المخزون والمستودعات (`catalog`, `inventory`) | 14 | 9 | 2 | 1 | 2 | **71%** | Backend WMS متقدم (FIFO/Cost Layers/Transfers/Stocktake)؛ UI يعود للبيانات الوهمية بسبب `.data` |
| 5 | المشتريات والموردون (`purchasing`) | 11 | 7 | 2 | 0 | 2 | **73%** | دورة PO/GRN/3-Way Match/Returns/Payments مكتملة في Backend؛ PR جزئي وUI مكسور بسبب `.data` |
| 6 | المحاسبة والمالية والتسويات (`accounting`, `partners`, `settlements`, `audit`) | 17 | 13 | 3 | 0 | 1 | **85%** | أقوى موديول في النظام (GL/PostingEngine/PeriodClosing/Reconciliation/Settlements)؛ ينقصه Export/Print و`.for('update')` في subledgers |
| 7 | التوصيل والتشغيل (`delivery`) | 8 | 4 | 2 | 1 | 1 | **63%** | Backend يغطي Zones/Drivers/Orders/COD + GL؛ أخطاء RBAC `:` و`err.response` في UI وغياب تتبع حي |
| 8 | الموارد البشرية دون الرواتب (`hr`) | 7 | 5 | 1 | 0 | 1 | **79%** | Backend متكامل ومختبر (Employees/Docs/Attendance/Shifts/Leaves/Advances/Custody)؛ UI مكسور بسبب `.data` |
| 9 | التكاملات والإدارة (`tenant` integrations, `media`, dashboard) | 10 | 6 | 3 | 1 | 0 | **75%** | Encryption/Key Rotation/Webhook Replay مكتملة؛ ثغرة SVG XSS في `media` وغياب Monitoring/Backups/Bell |
| 10 | الامتثال والفوترة الإلكترونية (`zatca`) | 7 | 5 | 2 | 0 | 0 | **86%** | محرك V2 + XAdES + QR + ICV/PIH/Outbox مكتمل ومختبر (`16/16`)؛ يفتقر للتحقق الحي بـ CA/OTP + Zod في Controller |

---

## 4. Frontend Completeness Matrix (`apps/web/src`)

| الشاشة / الملف | الربط الفعلي بالـ API | Pagination / Search | حالات Loading / Error / Empty | مشاكل حرجة مرصودة | التصنيف |
|---|---|---|---|---|---|
| `PosView.tsx` | مكسور | Search جزئي / لا Pagination | بدون Spinner، `alert()` | يقرأ `res?.data` (دائمًا `undefined`) ويعود لـ `SAMPLE_PRODUCTS`؛ يزيّف Checkout عند غياب `uomId`؛ هيدر ثابت؛ Split Payment ثابت 50/50؛ ضريبة `0.15` ثابتة؛ لا طباعة ولا Offline | **BROKEN / MOCKED** |
| `CatalogView.tsx` | مكسور | لا Pagination | `alert()`/`confirm()` | يقرأ `res.value?.data` ويعود لـ `INITIAL_CATEGORIES`/`INITIAL_PRODUCTS`؛ رفع الصور يحوّلها لـ Base64 محلي بدل `/api/v1/media/upload` | **BROKEN / MOCKED** |
| `InventoryView.tsx` | مكسور | لا Pagination | `alert()` | يقرأ `res.value?.data` ويعود لـ `INITIAL_WAREHOUSES`/`INITIAL_BALANCES` | **BROKEN / MOCKED** |
| `DiningView.tsx` | مكسور | لا Pagination | بدون Spinner، `alert()` | يقرأ `res.value?.data`؛ بدون تحديث تلقائي للـ KDS؛ Modifiers نص حر فقط | **BROKEN** |
| `PurchasingView.tsx` | مكسور | لا Pagination | `alert()`/`confirm()` | يقرأ `res?.data` ويعود لـ `INITIAL_POS`/`INITIAL_PAYMENTS` | **BROKEN / MOCKED** |
| `ProductionView.tsx` | مكسور | لا Pagination/Search | جزئي | يقرأ `recRes?.data`, `batRes?.data`, `wstRes?.data` | **BROKEN** |
| `HrEmployeesView.tsx` | مكسور | لا Pagination في UI | جزئي | يقرأ `empRes?.data?.items` و`.data` | **BROKEN** |
| `TransfersView.tsx` | مكسور جزئيًا | Pagination موجود | خطأ `err.response` | يتوقع مصفوفة من `/catalog/items?limit=200` بينما يرجع كائنًا؛ يقرأ `err?.response?.data?.message` | **BROKEN** |
| `PosShiftClosingView.tsx` | مكسور جزئيًا | لا Pagination | جيد | يستدعي `GET /accounting/cash-vaults` (404) بدل `/accounting/vaults` | **BROKEN** |
| `DeliveryView.tsx` | متصل | لا Pagination/Search | خطأ `err.response` | يقرأ `err?.response?.data?.message` فتضيع رسائل الخطأ | **PARTIAL** |
| `SettlementsView.tsx` | متصل | Pagination موجود | خطأ `err.response` | يقرأ `err?.response?.data?.message` | **PARTIAL** |
| `ZatcaV2View.tsx` | متصل | لا Pagination/Search | جيد | لا بحث ولا ترقيم للفواتير وOutbox | **PARTIAL** |
| `AccountingView.tsx`, `FinancialResourcesView.tsx`, `AccountMappingView.tsx`, `PeriodClosingView.tsx`, `ReconciliationReportingView.tsx`, `AuditLogsView.tsx`, `CompaniesView.tsx`, `UsersView.tsx`, `RolesView.tsx`, `SettingsView.tsx`, `DashboardView.tsx`, `IndustryPacksView.tsx` | متصل | موجود في `PeriodClosing`, `AuditLogs`, `Reconciliation`؛ مفقود في `AccountingView` (`limit=100`) و`Users` و`Roles` | متفاوت (`Dashboard`/`IndustryPacks` تبتلع الأخطاء) | تباين تمرير `/api/v1` (يعمل بسبب `replace` في `client.ts`)؛ غياب Export/Print في جميع الشاشات | **PARTIAL / COMPLETE** |
| `Navbar.tsx` & `Sidebar.tsx` & `App.tsx` | — | — | — | شارة `"PostgreSQL 16 متصل"` ثابتة؛ زر الجرس `<Bell />` غير مربوط؛ `Sidebar` بعرض ثابت `w-64` غير متجاوب؛ `App.tsx:98` يوجّه تبويب `transfers` إلى `InventoryView` | **PARTIAL / MOCKED** |

---

## 5. Backend Completeness Matrix (`apps/api/src/modules`)

| الموديول | نقاط القوة | الفجوات والعيوب المؤكدة بالأدلة | التصنيف |
|---|---|---|---|
| `iam` & `tenant` | Onboarding ذري، Key Rotation، Webhook Replay Protection، حدود الاشتراك، Hierarchy | `TenantContextGuard` ينفذ 5 استعلامات/طلب (N+1)؛ غياب Zod في 3 endpoints (`tenant.controller.ts:282,294,337`)؛ غياب `@RequirePermissions` على 4 مسارات `GET` | **PARTIAL** |
| `sales` | `createSalesOrder` متكامل مع `PostingEngine` وIdempotency وShift Closing | `refundSalesOrder` غير مكشوف في `sales.controller.ts`؛ لا Quotations ولا Promotions؛ لا Offline Sync؛ غياب `.for('update')` على `cashVaults` و`partnerBalances`؛ `.limit(200)` ثابت في `listShifts` | **PARTIAL** |
| `dining` | إدارة الطاولات والجلسات والنقل والدمج وKDS وSplit Bill | لا Reservations؛ Multi-kitchen عبر نص `station` فقط دون إعدادات محطات؛ 6 مسارات `POST/PATCH` دون Zod | **PARTIAL** |
| `production` | وصفات، تحويل وحدات، دفعات إنتاج، هدر | **يتجاوز `InventoryService`** ويعتمد على `defaultCost` وبدون `.for('update')`؛ **يربط `PostingEngine` اختياريًا بأكواد ثابتة (`1300/1050`)** | **PARTIAL / BROKEN** |
| `catalog` & `inventory` | WMS متكامل (FIFO، Cost Layers، Transfers، Discrepancies، Stocktake، Adjustments، `.for('update')` x29) | غياب `@RequirePermissions` على 9 مسارات `GET` في `inventory.controller.ts` | **COMPLETE (with RBAC gap)** |
| `media` | فحص 5MB وExtension وMagic Bytes للصور وPDF | يسمح بـ `image/svg+xml` دون تعقيم ويعرضه inline في `media.controller.ts:132-145` (خطر Stored XSS)؛ لا اختبارات Controller HTTP | **PARTIAL** |
| `purchasing` | دورة كاملة PO -> GRN -> 3-Way Match -> Invoice -> Return -> Payment + `.for('update')` x13 | `Purchase Requests` فيها `POST` فقط دون `GET`/اعتماد/تحويل لـ PO؛ القوائم ثابتة `.limit(100)`؛ غياب `@RequirePermissions` على 6 مسارات `GET` | **PARTIAL** |
| `accounting` & `partners` & `settlements` | `PostingEngine` ذري، COA هرمي، `PeriodClosing`، `Reconciliation`، `Settlements` (CSV/XLSX) | `ar-subledger` و`ap-subledger` بدون `.for('update')` وبدون `idempotencyKey`؛ 4 مسارات `POST` في `accounting.controller.ts` دون Zod؛ 15 مسار `GET` دون `@RequirePermissions` | **PARTIAL / COMPLETE** |
| `delivery` | Zones، Drivers، Orders، COD Settlements + `PostingEngine` | `delivery.controller.ts` يستخدم `:` بدل `.` في الصلاحيات (`delivery:manage`) مما يكسر wildcard matching؛ لا Zod على جميع `@Body()`؛ لا `.for('update')` في `settleDriverCod` | **PARTIAL** |
| `hr` | موظفون، مستندات، حضور، ورديات، إجازات، سلف، عهد (دون Payroll) | غياب `.for('update')` في `disburseAdvance`/`recoverAdvance` على `cashVaults` و`employeeAdvances` | **COMPLETE (with concurrency gap)** |
| `zatca` | V2 معزول عن V1/Production، XAdES، QR TLV، Outbox/Watchdog | `zatca.controller.ts` يقبل `@Body() body: any` في 8 مسارات `POST` دون Zod | **PARTIAL** |
| `audit` | جدول append-only محمي بـ Trigger وRLS | لا توجد اختبارات لـ `AuditController` (`GET /audit-logs`) أو `AuditService.queryLogs` | **PARTIAL** |

---

## 6. Database / Security Audit

### قاعدة البيانات (`packages/database` & Staging DB)
- **الحالة الفعلية على Staging:** `124` جدولًا، `420` فهرسًا، `28` ترحيلًا مسجلًا (`0000`–`0027`)، و**`0` فجوات** في `RLS` أو `FORCE RLS` أو السياسات على جداول `tenant_id`.
- **فهارس وقيود مفقودة على الجداول عالية الكثافة:**
  - `sales_orders`: فهارس `shift_id`، `(tenant_id, legal_entity_id, status)`، وفريد `(tenant_id, idempotency_key)`.
  - `payments`: `(tenant_id, settlement_status, payment_method)` وفريد `(tenant_id, idempotency_key)`.
  - `journal_entries` / `journal_lines`: `(tenant_id, source_type, source_id)`، `(tenant_id, legal_entity_id, status, entry_date)`، `branch_id`، `(subledger_document_type, subledger_document_id)`.
  - `inventory_movements` / `inventory_balances` / `inventory_cost_layers`: ربط FK لـ `item_id` وفهرس `(tenant_id, source_type, source_id)`.
  - `purchasing` & `partners`: فهارس `purchase_order_id`, `supplier_id`, `goods_receipt_id`, `due_date`.
  - `tenants.ts`: فهرس `membership_scopes(scope_type, scope_id)` و`notification_logs(status, next_retry_at)`.

### الأمان (Security Findings)
- **Critical — SQL Injection Risk:** `operations-framework.service.ts:155-157` يبني `sql.raw` مدمجًا نصيًا لـ `entityId`.
- **High — Stored XSS via SVG Upload:** `media.service.ts:20` + `media.controller.ts:132-145` (`image/svg+xml` inline).
- **High — Missing Rate Limiting:** لا يوجد `@nestjs/throttler` أو `@fastify/rate-limit` على `/auth/login` أو endpoints العامة.
- **High — RBAC Separator & Missing `GET` Guards:** `delivery.controller.ts` يستخدم `:` بدل `.`، وأكثر من `35` مسار `GET` في `inventory`, `purchasing`, `production`, `accounting`, `sales`, `dining`, `tenant` تعتمد على `PermissionsGuard` دون `@RequirePermissions`.
- **Medium — Unvalidated `@Body()`:** `delivery.controller.ts`, `zatca.controller.ts`, وبعض مسارات `dining`, `tenant`, `accounting`, `sales` لا تمر عبر Zod schema.

---

## 7. End-to-End Workflow Audit

| # | دورة العمل E2E | الخطوات الناجحة | الخطوات المفقودة / المكسورة | أخطاء الترحيل / التكرار / المخزون | الاختبارات المطلوبة |
|---|---|---|---|---|---|
| 1 | شراء → استلام → فاتورة مورد → مخزون → حسابات المورد → GL | مكتملة بالكامل في `purchasing.service.ts` + `InventoryService` + `PostingEngine` | `PurchasingView` في UI مكسورة بسبب `.data`؛ `Purchase Requests` غير مكتملة | لا يوجد في Backend (ذري بـ `.for('update')`) | اختبار E2E من الواجهة بعد إصلاح `.data` |
| 2 | بيع من POS → دفع → خصم مخزون → COGS → GL → تقرير المبيعات | Backend `createSalesOrder` يعمل ويختبر في `phase3-4a` | `PosView` مكسورة بسبب `.data`، Split Payment ثابت 50/50، لا طباعة إيصال، لا خصومات | `sales.service.ts` يحدّث `cashVaults` دون `.for('update')`؛ يمر عبر `productionService.consumeForSaleTx` بدل `InventoryService` | اختبار تزامن خزينة POS + اختبار UI حقيقي |
| 3 | مرتجع بيع → رد مبلغ → عكس الضريبة → معالجة المخزون | `refundSalesOrder` منفّذة في `sales.service.ts:1686-1982` | **غير مكشوفة في `sales.controller.ts`** ولا توجد شاشة مرتجع في `PosView` | غياب `.for('update')` على `cashVaults` عند الرد | تعريض Endpoint + اختبار HTTP + واجهة مرتجع |
| 4 | طلب مطعم → طاولة → مطبخ → تجهيز → تقديم → تحصيل → إغلاق الجلسة | Backend `dining.service.ts` متكامل ومختبر في `dining-kds.spec.ts` | `DiningView` مكسورة بسبب `.data`؛ لا تحديث فوري للـ KDS؛ لا Reservations | يحيل التحصيل إلى `salesService.createSalesOrder` | اختبار UI + polling/SSE للـ KDS |
| 5 | وصفة → إنتاج → استهلاك خامات → منتج نهائي → تكلفة | `production-recipes.spec.ts` يختبرها | `ProductionView` مكسورة بسبب `.data` | `production.service.ts` يتجاوز `InventoryService` ويستخدم أكواد حسابات ثابتة (`1300/1050`) وقد يتخطى GL بصمت | إعادة ربط `ProductionService` بـ `InventoryService` و`AccountMappingEngine` |
| 6 | تحويل مخزون بين مستودعين → استلام → فروقات → إقفال التحويل | Backend + `inventory-wms-phase-b.spec.ts` و`phase3-4d` مكتملان | `TransfersView` تفشل في جلب الأصناف ورسائل الخطأ (`err.response`)؛ تبويب Sidebar يفتح `InventoryView` | نقص فهرس فريد على `dispatch_idempotency_key` و`receive_idempotency_key` | اختبار UI والتحويل المباشر |
| 7 | توصيل → تعيين سائق → تسليم → COD → تسوية خزينة | Backend + `delivery-drivers.spec.ts` مكتملان | `DeliveryView` تفشل في عرض رسائل الخطأ؛ صلاحيات `:` في Controller؛ لا Zones CRUD في UI | `settleDriverCod` دون `.for('update')` على الخزينة وطلبات التوصيل | اختبار تزامن تسوية السائق + إصلاح RBAC |
| 8 | إغلاق وردية → مطابقة النقد والمدفوعات → إثبات العجز أو الزيادة | Backend `phase3-4b-pos-shift-closing.spec.ts` مكتمل | `PosShiftClosingView:150` يستدعي `/accounting/cash-vaults` (404)؛ `PosView` لا يكتشف الوردية النشطة بسبب `.data` | يعمل ذريًا في Backend | إصلاح المسار واختبار E2E من الافتتاح للإغلاق |
| 9 | إقفال فترة محاسبية → منع القيود → إعادة فتح بصلاحية مستقلة | Backend + `phase3-6-period-closing.spec.ts` مكتملان | غياب Zod على `close`/`reopen` في `accounting.controller.ts` | سليم تمامًا | إضافة Zod validation + اختبار HTTP |
| 10 | Offline POS → عمليات محلية → إعادة الاتصال → مزامنة دون فقد أو تكرار | جدول `offline_quota_leases` فقط | **مفقودة بالكامل** (Backend Sync API + Frontend IndexedDB/Queue + Concurrency/Idempotency tests) | خطر فقد أو تكرار الطلبات عند انقطاع الشبكة | تصميم وتنفيذ كامل + اختبارات انقطاع الشبكة |

---

## 8. UI/UX Audit

| المشكلة | الملف والموقع | الأثر | الإصلاح المقترح |
|---|---|---|---|
| **تضاعف فك التغليف `.data`** | 8 ملفات (`PosView.tsx:79`, `CatalogView.tsx:143`, `InventoryView.tsx:383`, `DiningView.tsx:78`, `PurchasingView.tsx:147`, `ProductionView.tsx:62`, `HrEmployeesView.tsx:152`, `TransfersView.tsx:134`) | تعطل عرض البيانات الحية وعودة الشاشات للبيانات التجريبية | توحيد الاستهلاك لقراءة استجابة `apiClient` مباشرة دون `.data` وإزالة كل بيانات `INITIAL_*` / `SAMPLE_*` الوهمية |
| **أخطاء Axios على عميل `fetch`** | `DeliveryView.tsx:165`, `SettlementsView.tsx:105`, `TransfersView.tsx:109` | ظهور رسائل خطأ مبهمة للمستخدم | استبدال `err?.response?.data?.message` بـ `err?.message` |
| **عدم دعم الإنجليزية LTR** | `App.tsx:45`, `LoginView.tsx:55`, معظم المكونات | النظام عربي فقط رغم وجود إعداد `primaryLocale` في `SettingsView:433` | ربط `i18n` خفيف و`dir={locale === 'en-US' ? 'ltr' : 'rtl'}` |
| **عدم التجاوب (Responsive)** | `Sidebar.tsx:196` (`w-64`), `PosView.tsx:218,365` (`w-96`), `App.tsx:83` (`p-8`) | انكسار الشاشة على التابلت وشاشات POS الصغيرة والجوال | تحويل `Sidebar` إلى Drawer متجاوب وجعل سلة `PosView` قابلة للطي على الشاشات المتوسطة |
| **تجربة الكاشير واللمس** | `PosView.tsx:407,416` (أزرار `w-5 h-5`)، غياب اختصارات لوحة المفاتيح والباركود، `alert()`/`confirm()` | بطء شديد للكاشير وصعوبة الاستخدام باللمس | تكبير أزرار اللمس (`min-h-10`), دعم Barcode input focus, اختصارات `F1-F12`, استبدال `alert/confirm` بـ Toast/Modal |
| **غياب الطباعة والتصدير** | جميع المكونات (28 ملفًا) | لا يمكن طباعة فاتورة POS أو تصدير تقارير مالية/ضريبية | بناء مكون `ReceiptPrint` حراري/A4 ومساعد تصدير `CSV/Excel` موحد |
| **عناصر شكلية غير فعالة** | `Navbar.tsx:90-99` (جرس الإشعارات وشارة PostgreSQL الثابتة) | تضليل المستخدم بوجود تنبيهات/مراقبة غير حقيقية | ربط شارة الحالة بـ `/health/readiness` وربط الجرس بـ `/tenants/notifications` |

---

## 9. Accounting & Inventory Integrity

- **نقاط القوة:** `PostingEngineService` يضمن توازن القيد (`Debit === Credit`) ومنع الترحيل للحسابات الأب أو الفترات المغلقة؛ `PurchasingService` و`InventoryService` و`SettlementsService` و`PeriodClosingService` و`ReconciliationService` مترابطة ومحكومة باختبارات Staging DB قوية.
- **نقاط الخلل الواجب إصلاحها:**
  1. **تجاوز `InventoryService` في `ProductionService` (`production.service.ts:570-895, 1060-1265`):** استخدام `items.defaultCost` وتعديل `inventoryBalances` دون `InventoryService` أو `.for('update')` يكسر دقة FIFO وتكلفة البضاعة المباعة.
  2. **قيود GL هشة في `ProductionService` (`:703-735, 877-895`):** الاعتماد على أكواد حسابات ثابتة (`1300/1050`) بدل `AccountMappingEngine` قد يؤدي لعدم ترحيل قيود الإنتاج والهدر بصمت.
  3. **غياب `.for('update')` في `sales.service.ts`, `delivery.service.ts`, `hr.service.ts`, `ar-subledger.service.ts`, `ap-subledger.service.ts`:** خطر سباق التزامن (Race Condition) على `cashVaults.balance` و`partnerBalances` عند الدفع أو التحصيل المتزامن.

---

## 10. Performance / Scalability Findings

- **N+1 في الحارس الأمني:** `TenantContextGuard.canActivate` ينفذ 5 استعلامات قاعدة بيانات متتالية في كل طلب HTTP دون تخزين مؤقت قصير الأمد (TTL cache / Redis).
- **غياب Pagination في عدة خدمات:** `purchasing.service.ts`, `sales.service.ts` (`listShifts`, `getSalesOrders`), `delivery.service.ts` تفرض `.limit(100/200)` دون `page`/`offset` أو ترقيم Server-side، مع فلترة في الذاكرة داخل `listShifts`.
- **فهارس مفقودة:** مفصلة في القسم 6 (`sales_orders.shift_id`, `journal_entries`, `inventory_movements`, `ar/ap_invoices`, `membership_scopes`).

---

## 11. Missing Features

1. **Offline POS & Synchronization** (استخدام `offline_quota_leases` + IndexedDB/Queue محلي + Sync Endpoint بـ Idempotency).
2. **Receipt Printing (Thermal 80mm / A4 Tax Invoice + QR)** في `PosView` و`DiningView` و`ZatcaV2View`.
3. **Promotions & Discounts Engine** (خصومات على مستوى الصنف والفاتورة، أكواد خصم، صلاحيات الخصم).
4. **Quotations (عروض الأسعار)** وتحويلها إلى Sales Order / AR Invoice.
5. **Table Reservations & Visual Floor Plan** في `Dining` وربط محطات المطبخ (Multi-kitchen station setup).
6. **Purchase Requests (PR) Workflow الكامل** (`GET`، اعتماد/رفض، تحويل تلقائي إلى PO).
7. **Export (CSV / Excel / PDF)** للتقارير المالية والضريبية وكشوف الحساب والمخزون.
8. **Rate Limiting (`@nestjs/throttler`) & Structured Monitoring/Backup Runbooks**.
9. **RTL/LTR Bilingual Switcher (Arabic/English)**.

---

## 12. Broken / Mocked Features

1. **8 شاشات Frontend مكسورة بسبب قراءة `.data` مرتين:** `PosView`, `CatalogView`, `InventoryView`, `DiningView`, `PurchasingView`, `ProductionView`, `HrEmployeesView`, `TransfersView`.
2. **بيانات وهمية Fallback في الواجهات:** `SAMPLE_PRODUCTS` (`PosView`), `INITIAL_CATEGORIES`/`INITIAL_PRODUCTS` (`CatalogView`), `INITIAL_WAREHOUSES`/`INITIAL_BALANCES` (`InventoryView`), `INITIAL_POS`/`INITIAL_PAYMENTS` (`PurchasingView`).
3. **Endpoint مكسور (404):** `PosShiftClosingView.tsx:150` (`GET /accounting/cash-vaults`).
4. **Checkout وهمي ورفع صور وهمي:** `PosView.tsx:210-214` (محاكاة Checkout عند غياب `uomId`), `CatalogView.tsx:441-463` (Base64 بدل `media/upload`).
5. **مرتجعات المبيعات غير مكشوفة (`sales.controller.ts`):** `refundSalesOrder` موجودة في `sales.service.ts` دون Route.
6. **عناصر Navbar شكلية:** شارة `"PostgreSQL 16 متصل"` وزر `<Bell />`.
7. **استخراج أخطاء خاطئ:** `err?.response?.data?.message` في `DeliveryView`, `SettlementsView`, `TransfersView`.
8. **عدم تطابق فاصل RBAC في التوصيل:** `delivery:manage` بدل `delivery.manage`.

---

## 13. Risks and Dependencies

- **مخاطر البيانات المالية والمخزنية:** استمرار `ProductionService` في تجاوز `InventoryService` و`AccountMappingEngine`، وغياب `.for('update')` في `Sales`/`Delivery`/`HR`/`Subledgers` يمثلان أعلى خطر محاسبي ومخزني عند التزامن.
- **مخاطر أمنية فورية:** `sql.raw` في `operations-framework.service.ts`، و`image/svg+xml` في `media.service.ts`، وغياب Rate Limiting، وغياب `@RequirePermissions` على مسارات `GET`.
- **اعتماديات التنفيذ:** إصلاح `apiClient` / الشاشات الثماني يفتح الاختبار الفعلي لكل دورات Frontend؛ وتصحيح `ProductionService` يعتمد على `InventoryService` و`AccountMappingEngine` القائمين.

---

## 14. Prioritized Implementation Roadmap & 15. Acceptance Criteria

> **ملاحظة:** لن يبدأ أي تنفيذ إلا بعد اعتماد هذه الخطة.

### المرحلة 1: الإصلاحات الأمنية الحرجة وتحصين التزامن (Security, Validation & Row Locks) — الأولوية القصوى
- **النطاق:**
  - استبدال `sql.raw` في `operations-framework.service.ts:155-157` باستعلام parameterized آمن والتحقق من UUID.
  - إزالة `image/svg+xml` من `media.service.ts` (أو تعقيمه + فرض `Content-Disposition: attachment` و`X-Content-Type-Options: nosniff` في `media.controller.ts`).
  - تفعيل Rate Limiting (`@nestjs/throttler` / `@fastify/rate-limit`) خاصة على `/auth/login`.
  - توحيد فاصل الصلاحيات في `delivery.controller.ts` إلى `.`، وإضافة `@RequirePermissions` لكل مسارات `GET` غير المحمية، وإضافة Zod validation لـ `delivery`, `zatca`, `dining`, `tenant`, `accounting`, `sales`.
  - إضافة `.for('update')` على `cashVaults`, `partnerBalances`, `employeeAdvances`, `deliveryOrders` في `sales.service.ts`, `delivery.service.ts`, `hr.service.ts`, `ar-subledger.service.ts`, `ap-subledger.service.ts`.
- **الملفات المتأثرة:** `operations-framework.service.ts`, `media.service.ts`, `media.controller.ts`, `app.module.ts`, `main.ts`, `delivery.controller.ts`, `zatca.controller.ts`, `sales.service.ts`, `delivery.service.ts`, `hr.service.ts`, `ar-subledger.service.ts`, `ap-subledger.service.ts`.
- **DB Migrations:** لا يوجد.
- **الاختبارات ومعايير القبول:** اختبارات أمنية سلبية (SQLi, SVG XSS, Rate Limit 429, RBAC 403 على `GET`، Zod 400)، واختبارات تزامن `Promise.allSettled` على الخزائن والشركاء دون رصيد سالب.

### المرحلة 2: إصلاح التكامل المالي والمخزني المكسور (`ProductionService` & `Sales` Refund Route)
- **النطاق:**
  - إلغاء التعديل المباشر للمخزون في `production.service.ts` وتوجيه الإضافة/الصرف/الهدر عبر `InventoryService` (FIFO/Cost Layers) مع `.for('update')`.
  - استبدال الأكواد الثابتة (`1300/1050`, `1200/1040`) في `production.service.ts` بـ `AccountMappingEngine` + `DefaultAccountMappingKey` (إلزامي دون تخطي صامت).
  - تعريض `POST /api/v1/sales/orders/:id/refund` في `sales.controller.ts` مع Zod DTO و`@RequirePermissions('sales.refund')` و`idempotencyKey`.
- **الملفات المتأثرة:** `production.service.ts`, `sales.controller.ts`, `sales.service.ts`.
- **DB Migrations:** لا يوجد.
- **الاختبارات ومعايير القبول:** نجاح `production-recipes.spec.ts` و`phase3-4a-sales-transaction-integration.spec.ts` + اختبار HTTP لـ `/sales/orders/:id/refund` ومطابقة `Trial Balance` بعد الإنتاج والهدر والمرتجع.

### المرحلة 3: إصلاح ربط Frontend بالبيانات الحية وإزالة البيانات الوهمية
- **النطاق:**
  - إزالة قراءة `.data` المكررة من `PosView`, `CatalogView`, `InventoryView`, `DiningView`, `PurchasingView`, `ProductionView`, `HrEmployeesView`, `TransfersView`.
  - حذف جميع المصفوفات الوهمية (`SAMPLE_PRODUCTS`, `INITIAL_*`) واستبدال محاكاة Checkout/Upload بالربط الحقيقي (`/media/upload`, `/sales/orders`).
  - إصلاح `PosShiftClosingView.tsx:150` إلى `/api/v1/accounting/vaults`.
  - استبدال `err?.response?.data?.message` بـ `err?.message` في `DeliveryView`, `SettlementsView`, `TransfersView`.
  - ربط `Navbar` بـ `/health/readiness` و`/tenants/notifications`، وتوجيه تبويب `transfers` مباشرة لـ `TransfersView`.
- **الملفات المتأثرة:** 12 ملفًا في `apps/web/src/components/` و`App.tsx`.
- **DB Migrations:** لا يوجد.
- **الاختبارات ومعايير القبول:** فحص فعلي في المتصفح لجميع الشاشات على Staging دون أخطاء Network 404 أو بيانات Mock، وبناء `apps/web` بنسبة 100%.

### المرحلة 4: الفهارس والأداء والترقيم Server-side (DB & Backend Performance)
- **النطاق:**
  - إضافة فهارس الأداء والقيود الفريدة المفقودة (`sales_orders.shift_id`, `payments`, `journal_entries`, `inventory_movements`, `purchasing`, `partners`, `membership_scopes`, `notification_logs`).
  - إضافة Pagination حقيقي (`page`, `limit`, `total`) في `purchasing.service.ts`, `sales.service.ts`, `delivery.service.ts`، وإضافة TTL cache قصير في `TenantContextGuard`.
  - إضافة اختبارات HTTP (Fastify `inject`) لـ `AuditController` و`MediaController`.
- **DB Migrations:** ترحيل جديد `0028_performance_indexes.sql` (`CREATE INDEX CONCURRENTLY` أو قياسي مع التحقق على Staging).
- **الاختبارات ومعايير القبول:** نجاح جميع اختبارات الانحدار + قياس عدم وجود Full Table Scans على الاستعلامات الأساسية ونجاح اختبارات `AuditController`/`MediaController`.

### المرحلة 5: استكمال الوظائف التجارية لـ POS والمطاعم والطباعة وOffline POS
- **النطاق:**
  - **Offline POS & Sync:** تفعيل `offline_quota_leases` في Backend + `POST /api/v1/sales/offline-sync` بالاعتماد على `idempotencyKey`، وتخزين `IndexedDB` في `PosView` مع مزامنة تلقائية عند عودة الاتصال.
  - **Receipt Printing & Export:** قالب طباعة حرارية 80mm وA4 (مع QR ZATCA) في `PosView`/`DiningView`، ومساعد تصدير `CSV/Excel` في التقارير والجداول.
  - **POS Enhancements:** شاشة مرتجعات المبيعات، Split Payments بمرونة المبالغ وتعدد الوسائل، خصومات الصنف والفاتورة، ضريبة ديناميكية حسب الصنف، اختصارات الكيبورد والباركود، وأزرار لمس مريحة.
  - **Purchasing & Dining Enhancements:** إكمال `GET`/اعتماد/تحويل `Purchase Requests`، وإعدادات محطات المطبخ (Multi-kitchen) + تحديث دوري للـ KDS + Zones CRUD في `DeliveryView`.
- **DB Migrations:** ترحيل اختياري `0029_promotions_kitchen_stations.sql` عند اعتماد نطاق العروض ومحطات المطبخ.
- **الاختبارات ومعايير القبول:** اختبارات E2E كاملة لـ Offline Sync (انقطاع اتصال + إعادة إرسال دون تكرار)، وطباعة الفواتير، والخصومات، وPR-to-PO.

### المرحلة 6: تجربة المستخدم UI/UX والتجاوب ودعم اللغتين (RTL/LTR)
- **النطاق:**
  - تحويل `Sidebar` إلى Drawer متجاوب للأجهزة اللوحية والجوال، وتحسين تخطيط `PosView` على الشاشات المتوسطة.
  - تفعيل محرك ترجمة (عربي RTL / إنجليزي LTR) مرتبط بـ `primaryLocale` في `SettingsView`.
  - استبدال `alert()` / `window.confirm()` بـ `ToastContext` ونوافذ تأكيد موحدة، وإضافة `aria-label` و`Loading/Empty States` لكل الشاشات.
- **الاختبارات ومعايير القبول:** مراجعة بصرية على Desktop وTablet وMobile باللغتين العربية والإنجليزية وبناء `apps/web` دون أخطاء.

---

## 16. Final Readiness Assessment

- **الوضع الحالي:** **NOT READY FOR COMMERCIAL LAUNCH** (نسبة الجاهزية المجمعة تقدر بنحو **~70%**؛ قوية جدًا في البنية التحتية للبيانات والمحاسبة، ولكنها معطلة في واجهات POS/المخزون/المشتريات/المطاعم بسبب أخطاء الربط، وتنقصها وظائف POS التجارية الحرجة مثل Offline Sync وطباعة الإيصالات وبعض ضوابط الأمان والتزامن).
- **المسار للجاهزية التجارية:** تنفيذ المراحل **1 → 4** يرفع الأمان والتكامل والواجهات الحية إلى مستوى تشغيلي موثوق، وتنفيذ المرحلتين **5 → 6** يكمل الجاهزية التجارية الكاملة للسوق السعودي (بالتوازي مع مسار اعتماد ZATCA Live Simulation عند توفر الشهادات وOTP).
