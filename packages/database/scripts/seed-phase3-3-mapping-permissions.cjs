const postgres = require('postgres');
const path = require('path');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));

async function seed() {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
  const sql = postgres(connectionString);

  console.log('Seeding Phase 3.3 Granular Account Mapping Permissions...');

  const mappingPermissions = [
    { code: 'accounting.mapping.view', resource: 'accounting_mapping', action: 'view', description: 'عرض إعدادات الربط المحاسبي المركزي واستثناءات الفروع' },
    { code: 'accounting.mapping.create', resource: 'accounting_mapping', action: 'create', description: 'إضافة ربط محاسبي جديد أو استثناء فرع' },
    { code: 'accounting.mapping.update', resource: 'accounting_mapping', action: 'update', description: 'تعديل الحسابات المرتبطة وتفعيلها وتعطيلها' },
    { code: 'accounting.mapping.delete', resource: 'accounting_mapping', action: 'delete', description: 'حذف استثناء فرع أو إعداد ربط محاسبي' },
    { code: 'accounting.mapping.manage', resource: 'accounting_mapping', action: 'manage', description: 'الإدارة الشاملة للربط المحاسبي المركزي واستثناءات الفروع' },
  ];

  for (const perm of mappingPermissions) {
    await sql`
      INSERT INTO permissions (code, resource, action, description)
      VALUES (${perm.code}, ${perm.resource}, ${perm.action}, ${perm.description})
      ON CONFLICT (code) DO UPDATE 
      SET description = EXCLUDED.description, resource = EXCLUDED.resource, action = EXCLUDED.action
    `;
    console.log(`- Ensured permission: ${perm.code}`);
  }

  // Grant these permissions to admin roles
  const adminRoles = await sql`
    SELECT id, tenant_id, code FROM roles 
    WHERE code IN ('COMPANY_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  `;
  console.log(`Found ${adminRoles.length} administrative roles across tenants.`);

  const permCodes = mappingPermissions.map((p) => p.code);
  const allPermRows = await sql`
    SELECT id, code FROM permissions WHERE code = ANY(${permCodes})
  `;

  for (const role of adminRoles) {
    for (const perm of allPermRows) {
      await sql`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (${role.id}, ${perm.id})
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `;
    }
  }

  console.log('Successfully assigned Phase 3.3 permissions to admin roles.');
  await sql.end();
}

seed().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
