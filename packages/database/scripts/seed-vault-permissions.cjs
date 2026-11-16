const postgres = require('postgres');
const path = require('path');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));

async function seed() {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
  const sql = postgres(connectionString);

  console.log('Seeding Granular Vault & Cash Management Permissions...');

  const vaultPermissions = [
    { code: 'accounting.vault.view', resource: 'accounting_vault', action: 'view', description: 'عرض تفاصيل الخزائن وسجل حركاتها وأرصدتها' },
    { code: 'accounting.vault.create', resource: 'accounting_vault', action: 'create', description: 'إضافة خزينة وصندوق نقدي جديد' },
    { code: 'accounting.vault.update', resource: 'accounting_vault', action: 'update', description: 'تعديل بيانات الخزينة وتفعيلها وتعطيلها' },
    { code: 'accounting.vault.delete', resource: 'accounting_vault', action: 'delete', description: 'حذف الخزائن غير المستخدمة التي لا تملك حركات' },
    { code: 'accounting.vault.disburse', resource: 'accounting_vault', action: 'disburse', description: 'إصدار سندات صرف نقدية من الخزينة' },
    { code: 'accounting.vault.receipt', resource: 'accounting_vault', action: 'receipt', description: 'إصدار سندات قبض نقدية وإيداعها بالخزينة' },
    { code: 'accounting.vault.transfer', resource: 'accounting_vault', action: 'transfer', description: 'تحويل الأموال النقدية بين الخزائن' },
    { code: 'accounting.vault.count', resource: 'accounting_vault', action: 'count', description: 'جرد الخزينة الفعلي وتسوية فروقات العجز والفائض' },
    { code: 'accounting.vault.manage', resource: 'accounting_vault', action: 'manage', description: 'الإدارة الشاملة لجميع عمليات الخزائن والصناديق' },
  ];

  for (const perm of vaultPermissions) {
    await sql`
      INSERT INTO permissions (code, resource, action, description)
      VALUES (${perm.code}, ${perm.resource}, ${perm.action}, ${perm.description})
      ON CONFLICT (code) DO UPDATE 
      SET description = EXCLUDED.description, resource = EXCLUDED.resource, action = EXCLUDED.action
    `;
    console.log(`- Ensured permission: ${perm.code}`);
  }

  // Grant these permissions to all COMPANY_ADMIN roles in all tenants
  const companyAdminRoles = await sql`SELECT id, tenant_id FROM roles WHERE code = 'COMPANY_ADMIN'`;
  console.log(`Found ${companyAdminRoles.length} COMPANY_ADMIN roles across tenants.`);

  const allPermIds = await sql`
    SELECT id, code FROM permissions WHERE code LIKE 'accounting.vault%'
  `;

  for (const role of companyAdminRoles) {
    for (const perm of allPermIds) {
      await sql`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (${role.id}, ${perm.id})
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `;
    }
  }

  console.log('Successfully assigned granular vault permissions to COMPANY_ADMIN roles.');

  await sql.end();
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
