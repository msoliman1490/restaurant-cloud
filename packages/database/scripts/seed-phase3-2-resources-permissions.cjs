const postgres = require('postgres');
const path = require('path');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));

async function seed() {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
  const sql = postgres(connectionString);

  console.log('Seeding Phase 3.2 Granular Permissions (Banks, Methods, Devices, Terminals)...');

  const permissionsToSeed = [
    // Bank Accounts
    { code: 'accounting.bank.view', resource: 'accounting_bank', action: 'view', description: 'عرض تفاصيل الحسابات البنكية وسجل حركاتها وأرصدتها' },
    { code: 'accounting.bank.create', resource: 'accounting_bank', action: 'create', description: 'إضافة حساب بنكي جديد للشركة القانونية' },
    { code: 'accounting.bank.update', resource: 'accounting_bank', action: 'update', description: 'تعديل بيانات الحساب البنكي وحالته' },
    { code: 'accounting.bank.delete', resource: 'accounting_bank', action: 'delete', description: 'حذف حساب بنكي غير مستخدم وخالٍ من الحركات والرصيد' },
    { code: 'accounting.bank.access', resource: 'accounting_bank', action: 'access', description: 'إدارة وتخصيص صلاحيات وصول الفروع للحسابات البنكية' },
    { code: 'accounting.bank.manage', resource: 'accounting_bank', action: 'manage', description: 'الإدارة الشاملة للحسابات البنكية وحركاتها' },

    // Payment Methods
    { code: 'accounting.payment_method.view', resource: 'accounting_payment_method', action: 'view', description: 'عرض طرق ووسائل الدفع المعتمدة' },
    { code: 'accounting.payment_method.manage', resource: 'accounting_payment_method', action: 'manage', description: 'الإدارة الشاملة لطرق الدفع وتفعيلها وتعطيلها' },

    // POS Devices
    { code: 'device.register', resource: 'device', action: 'register', description: 'تسجيل وإضافة جهاز نقطة بيع POS جديد' },
    { code: 'device.view', resource: 'device', action: 'view', description: 'عرض أجهزة نقاط البيع وحالتها التشغيلية' },
    { code: 'device.update', resource: 'device', action: 'update', description: 'تعديل بيانات جهاز POS وربطه بالخزينة النقدية' },
    { code: 'device.delete', resource: 'device', action: 'delete', description: 'إلغاء تفعيل أو حذف جهاز نقطة البيع' },
    { code: 'device.manage', resource: 'device', action: 'manage', description: 'الإدارة الشاملة لأجهزة نقاط البيع' },

    // Payment Terminals
    { code: 'terminal.register', resource: 'terminal', action: 'register', description: 'تسجيل جهاز دفع إلكتروني EDC جديد' },
    { code: 'terminal.view', resource: 'terminal', action: 'view', description: 'عرض أجهزة الدفع الإلكتروني EDC وحالتها' },
    { code: 'terminal.update', resource: 'terminal', action: 'update', description: 'تعديل إعدادات جهاز الدفع والربط بالوسيط وجهاز POS' },
    { code: 'terminal.delete', resource: 'terminal', action: 'delete', description: 'إيقاف أو حذف جهاز الدفع الإلكتروني' },
    { code: 'terminal.manage', resource: 'terminal', action: 'manage', description: 'الإدارة الشاملة لأجهزة الدفع الإلكتروني' },
  ];

  for (const perm of permissionsToSeed) {
    await sql`
      INSERT INTO permissions (code, resource, action, description)
      VALUES (${perm.code}, ${perm.resource}, ${perm.action}, ${perm.description})
      ON CONFLICT (code) DO UPDATE 
      SET description = EXCLUDED.description, resource = EXCLUDED.resource, action = EXCLUDED.action
    `;
    console.log(`- Ensured permission: ${perm.code}`);
  }

  // Grant these permissions to COMPANY_ADMIN and TENANT_ADMIN roles in all tenants
  const adminRoles = await sql`
    SELECT id, tenant_id, code FROM roles 
    WHERE code IN ('COMPANY_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  `;
  console.log(`Found ${adminRoles.length} administrative roles across tenants.`);

  const permCodes = permissionsToSeed.map((p) => p.code);
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

  console.log('Successfully assigned Phase 3.2 permissions to admin roles.');
  await sql.end();
}

seed().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
