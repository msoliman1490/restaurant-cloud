/**
 * Safe, idempotent backfill for Legal Entities missing standard Chart of Accounts,
 * Account Mappings, or Document Sequences.
 * - Never duplicates accounts (ON CONFLICT DO NOTHING).
 * - Never modifies existing accounts, names, or balances.
 * - Defaults to Staging DB via MIGRATIONS_DATABASE_URL.
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

function loadMigrationsDbUrl() {
  if (process.env.MIGRATIONS_DATABASE_URL) return process.env.MIGRATIONS_DATABASE_URL;
  const envPath = path.resolve(__dirname, '../../../.env');
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^MIGRATIONS_DATABASE_URL=(.+)$/m);
  if (!match || !match[1]) throw new Error('MIGRATIONS_DATABASE_URL not found');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const TEMPLATE = [
  { code: '100000', ar: 'الأصول', en: 'Assets', type: 'ASSET', bal: 'DEBIT', lvl: 1, post: false },
  { code: '200000', ar: 'الالتزامات', en: 'Liabilities', type: 'LIABILITY', bal: 'CREDIT', lvl: 1, post: false },
  { code: '300000', ar: 'حقوق الملكية', en: 'Equity', type: 'EQUITY', bal: 'CREDIT', lvl: 1, post: false },
  { code: '400000', ar: 'الإيرادات', en: 'Revenue', type: 'REVENUE', bal: 'CREDIT', lvl: 1, post: false },
  { code: '500000', ar: 'المصروفات والتكاليف', en: 'Expenses & COGS', type: 'EXPENSE', bal: 'DEBIT', lvl: 1, post: false },

  { code: '110000', ar: 'الأصول المتداولة', en: 'Current Assets', type: 'ASSET', bal: 'DEBIT', lvl: 2, parent: '100000', post: false },
  { code: '210000', ar: 'الالتزامات المتداولة', en: 'Current Liabilities', type: 'LIABILITY', bal: 'CREDIT', lvl: 2, parent: '200000', post: false },
  { code: '310000', ar: 'رأس المال والأرباح المبقاة', en: 'Capital & Retained Earnings', type: 'EQUITY', bal: 'CREDIT', lvl: 2, parent: '300000', post: false },
  { code: '410000', ar: 'إيرادات النشاط والمبيعات', en: 'Operating Revenue', type: 'REVENUE', bal: 'CREDIT', lvl: 2, parent: '400000', post: false },
  { code: '510000', ar: 'تكلفة المبيعات والمصروفات التشغيلية', en: 'COGS & Operating Expenses', type: 'EXPENSE', bal: 'DEBIT', lvl: 2, parent: '500000', post: false },

  { code: '111100', ar: 'الصناديق والخزائن النقدية', en: 'Cash & Vaults', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'CASH_VAULT' },
  { code: '111200', ar: 'الحسابات البنكية الجارية', en: 'Bank Accounts', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'BANK' },
  { code: '111300', ar: 'مقاصة مدى', en: 'Mada Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'MADA_CLEARING' },
  { code: '111350', ar: 'مقاصة البطاقات الإلكترونية', en: 'Card Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'CARD_CLEARING' },
  { code: '111400', ar: 'مقاصة فيزا وماستركارد', en: 'Visa / Mastercard Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'VISA_CLEARING' },
  { code: '111500', ar: 'مقاصة Apple Pay', en: 'Apple Pay Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'APPLE_PAY_CLEARING' },
  { code: '111600', ar: 'مقاصة STC Pay', en: 'STC Pay Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'STC_PAY_CLEARING' },
  { code: '111900', ar: 'النقدية في الطريق', en: 'Cash in Transit', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'CASH_IN_TRANSIT' },
  { code: '112000', ar: 'مخزون المواد الغذائية والمستودعات', en: 'Inventory', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'INVENTORY' },
  { code: '112900', ar: 'مخزون في الطريق', en: 'Inventory in Transit', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'INVENTORY_IN_TRANSIT' },
  { code: '113100', ar: 'ذمم العملاء المدينة', en: 'Accounts Receivable', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'ACCOUNTS_RECEIVABLE' },
  { code: '113200', ar: 'مستحقات تطبيقات التوصيل', en: 'Aggregator Receivable', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'AGGREGATOR_RECEIVABLE' },
  { code: '114200', ar: 'ضريبة القيمة المضافة - مدخلات', en: 'VAT Input', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'VAT_INPUT' },
  { code: '119100', ar: 'حساب مقاصة الفروع', en: 'Inter-Branch Clearing', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'INTER_BRANCH_CLEARING' },
  { code: '119200', ar: 'مستحق من شركات شقيقة', en: 'Due from Affiliate', type: 'ASSET', bal: 'DEBIT', lvl: 3, parent: '110000', post: true, map: 'DUE_FROM_AFFILIATE' },

  { code: '211100', ar: 'ذمم الموردين الدائنة', en: 'Accounts Payable', type: 'LIABILITY', bal: 'CREDIT', lvl: 3, parent: '210000', post: true, map: 'ACCOUNTS_PAYABLE' },
  { code: '211200', ar: 'ضريبة القيمة المضافة - مخرجات', en: 'VAT Output', type: 'LIABILITY', bal: 'CREDIT', lvl: 3, parent: '210000', post: true, map: 'VAT_OUTPUT' },
  { code: '211900', ar: 'معلقات تطبيقات التوصيل', en: 'Aggregator Suspense', type: 'LIABILITY', bal: 'CREDIT', lvl: 3, parent: '210000', post: true, map: 'AGGREGATOR_SUSPENSE' },
  { code: '219200', ar: 'مستحق لشركات شقيقة', en: 'Due to Affiliate', type: 'LIABILITY', bal: 'CREDIT', lvl: 3, parent: '210000', post: true, map: 'DUE_TO_AFFILIATE' },

  { code: '311000', ar: 'الأرباح المبقاة', en: 'Retained Earnings', type: 'EQUITY', bal: 'CREDIT', lvl: 3, parent: '310000', post: true, map: 'RETAINED_EARNINGS' },

  { code: '411000', ar: 'إيرادات المبيعات', en: 'Sales Revenue', type: 'REVENUE', bal: 'CREDIT', lvl: 3, parent: '410000', post: true, map: 'SALES' },
  { code: '411200', ar: 'مردودات المبيعات', en: 'Sales Returns', type: 'REVENUE', bal: 'DEBIT', lvl: 3, parent: '410000', post: true, map: 'SALES_RETURNS' },
  { code: '412000', ar: 'خصومات المبيعات', en: 'Sales Discounts', type: 'REVENUE', bal: 'DEBIT', lvl: 3, parent: '410000', post: true, map: 'SALES_DISCOUNTS' },
  { code: '419100', ar: 'فروقات التقريب', en: 'Rounding Difference', type: 'REVENUE', bal: 'CREDIT', lvl: 3, parent: '410000', post: true, map: 'ROUNDING_DIFFERENCE' },
  { code: '419200', ar: 'فائض الصندوق', en: 'Cash Overage', type: 'REVENUE', bal: 'CREDIT', lvl: 3, parent: '410000', post: true, map: 'CASH_OVERAGE' },
  { code: '419300', ar: 'أرباح ومكاسب المخزون', en: 'Inventory Gain', type: 'REVENUE', bal: 'CREDIT', lvl: 3, parent: '410000', post: true, map: 'INVENTORY_GAIN' },
  { code: '419400', ar: 'خصومات مكتسبة', en: 'Discounts Received', type: 'REVENUE', bal: 'CREDIT', lvl: 3, parent: '410000', post: true, map: 'DISCOUNTS_RECEIVED' },

  { code: '511000', ar: 'تكلفة البضاعة المباعة', en: 'Cost of Goods Sold', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'COGS' },
  { code: '512000', ar: 'عمولات تطبيقات التوصيل', en: 'Aggregator Commissions', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'AGGREGATOR_COMMISSION' },
  { code: '512100', ar: 'رسوم بوابات الدفع', en: 'Payment Gateway Fees', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'GATEWAY_FEES' },
  { code: '519000', ar: 'مصروفات عامة وتشغيلية', en: 'General Operating Expenses', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'GENERAL_EXPENSE' },
  { code: '519100', ar: 'عجز الصندوق', en: 'Cash Short', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'CASH_OVER_SHORT' },
  { code: '519200', ar: 'خسائر وتوالف المخزون', en: 'Inventory Damage & Loss', type: 'EXPENSE', bal: 'DEBIT', lvl: 3, parent: '510000', post: true, map: 'INVENTORY_DAMAGE_LOSS' },
];

const DEFAULT_PREFIX_MAP = {
  SALES_INVOICE: 'INV',
  POS_TRANSACTION: 'POS',
  PURCHASE_INVOICE: 'SINV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  JOURNAL_ENTRY: 'JV',
  RECEIPT: 'RCP',
  PAYMENT: 'PAY',
  PURCHASE_ORDER: 'PO',
  PURCHASE_REQUEST: 'PR',
  GOODS_RECEIPT: 'GRN',
  DELIVERY_NOTE: 'DLV',
  STOCK_TRANSFER: 'TRN',
  STOCK_ADJUSTMENT: 'ADJ',
};

async function main() {
  const sql = postgres(loadMigrationsDbUrl());
  const entities = await sql`SELECT id, tenant_id, legal_name, functional_currency FROM legal_entities ORDER BY created_at ASC`;
  let repairedEntities = 0;
  let totalAccountsAdded = 0;
  let totalMappingsAdded = 0;
  let totalSeqsAdded = 0;
  const yearStr = String(new Date().getUTCFullYear());

  for (const le of entities) {
    await sql.begin(async (tx) => {
      const existing = await tx`SELECT id, account_code FROM chart_of_accounts WHERE legal_entity_id = ${le.id}`;
      const codeToId = new Map(existing.map((r) => [r.account_code, r.id]));
      let addedAcc = 0;
      let addedMap = 0;
      let addedSeq = 0;

      for (const node of TEMPLATE) {
        if (!codeToId.has(node.code)) {
          const parentId = node.parent ? (codeToId.get(node.parent) || null) : null;
          const [ins] = await tx`
            INSERT INTO chart_of_accounts (
              tenant_id, legal_entity_id, account_code, name, name_ar, name_en,
              account_type, normal_balance, parent_id, level, is_postable, is_system, currency, status
            ) VALUES (
              ${le.tenant_id}, ${le.id}, ${node.code}, ${node.ar}, ${node.ar}, ${node.en},
              ${node.type}, ${node.bal}, ${parentId}, ${node.lvl}, ${node.post}, true, ${le.functional_currency || 'SAR'}, 'ACTIVE'
            )
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (ins) {
            codeToId.set(node.code, ins.id);
            addedAcc++;
          }
        }
      }

      const existingMaps = await tx`SELECT mapping_key FROM account_mappings WHERE legal_entity_id = ${le.id} AND branch_id IS NULL`;
      const mapKeys = new Set(existingMaps.map((m) => m.mapping_key));
      for (const node of TEMPLATE) {
        if (!node.map || mapKeys.has(node.map)) continue;
        const accId = codeToId.get(node.code);
        if (!accId) continue;
        await tx`
          INSERT INTO account_mappings (tenant_id, legal_entity_id, branch_id, mapping_key, account_id, description, is_active)
          VALUES (${le.tenant_id}, ${le.id}, NULL, ${node.map}, ${accId}, ${'الربط التلقائي: ' + node.ar}, true)
          ON CONFLICT DO NOTHING
        `;
        addedMap++;
      }

      const existingSeqs = await tx`SELECT document_type FROM document_sequences WHERE legal_entity_id = ${le.id} AND branch_id IS NULL AND period_key = ${yearStr}`;
      const seqSet = new Set(existingSeqs.map((s) => s.document_type));
      for (const [docType, prefix] of Object.entries(DEFAULT_PREFIX_MAP)) {
        if (seqSet.has(docType)) continue;
        await tx`
          INSERT INTO document_sequences (
            tenant_id, legal_entity_id, branch_id, document_type, period_key,
            prefix, starting_number, current_value, padding, fiscal_year_format, annual_reset_policy, is_active, is_locked_by_usage
          ) VALUES (
            ${le.tenant_id}, ${le.id}, NULL, ${docType}, ${yearStr},
            ${prefix}, 1, 0, 6, 'YYYY', 'ANNUAL', true, false
          )
          ON CONFLICT DO NOTHING
        `;
        addedSeq++;
      }

      if (addedAcc > 0 || addedMap > 0 || addedSeq > 0) {
        repairedEntities++;
        totalAccountsAdded += addedAcc;
        totalMappingsAdded += addedMap;
        totalSeqsAdded += addedSeq;
      }
    });
  }

  console.log(JSON.stringify({
    totalEntitiesScanned: entities.length,
    repairedEntities,
    totalAccountsAdded,
    totalMappingsAdded,
    totalSeqsAdded,
  }, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
