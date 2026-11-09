const postgres = require('../node_modules/postgres');
const path = require('path');
const fs = require('fs');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const url = process.env.MIGRATIONS_DATABASE_URL;

const SYSTEM_PERMISSIONS = [
  // Superadmin Wildcard
  { code: '*', resource: 'all', action: 'all', description: 'Full Superadmin Permissions' },

  // Legal Entities
  { code: 'legal_entity.read', resource: 'legal_entity', action: 'read', description: 'View legal entities' },
  { code: 'legal_entity.create', resource: 'legal_entity', action: 'create', description: 'Create new legal entity' },
  { code: 'legal_entity.update', resource: 'legal_entity', action: 'update', description: 'Update legal entity details' },
  { code: 'legal_entity.delete', resource: 'legal_entity', action: 'delete', description: 'Delete unreferenced legal entity' },

  // Branches
  { code: 'branch.read', resource: 'branch', action: 'read', description: 'View branches' },
  { code: 'branch.create', resource: 'branch', action: 'create', description: 'Create new branch' },
  { code: 'branch.update', resource: 'branch', action: 'update', description: 'Update branch details' },
  { code: 'branch.archive', resource: 'branch', action: 'archive', description: 'Archive branch' },

  // Users & Memberships
  { code: 'user.read', resource: 'user', action: 'read', description: 'View users and memberships' },
  { code: 'user.create', resource: 'user', action: 'create', description: 'Create and invite users' },
  { code: 'user.update', resource: 'user', action: 'update', description: 'Update user status and scopes' },
  { code: 'user.delete', resource: 'user', action: 'delete', description: 'Delete unreferenced user' },

  // Roles & Permissions
  { code: 'role.read', resource: 'role', action: 'read', description: 'View roles and permissions' },
  { code: 'role.create', resource: 'role', action: 'create', description: 'Create custom roles' },
  { code: 'role.update', resource: 'role', action: 'update', description: 'Update role permissions' },
  { code: 'role.delete', resource: 'role', action: 'delete', description: 'Delete custom roles' },

  // Tenant Settings
  { code: 'tenant.read', resource: 'tenant', action: 'read', description: 'View tenant settings and info' },
  { code: 'tenant.update', resource: 'tenant', action: 'update', description: 'Update tenant configuration' },

  // Audit Logs
  { code: 'audit.read', resource: 'audit', action: 'read', description: 'View immutable audit logs' },

  // Devices
  { code: 'device.register', resource: 'device', action: 'register', description: 'Register POS and terminal devices' },

  // Products & Items (Granular Operations Framework)
  { code: 'item.view', resource: 'item', action: 'view', description: 'View products and catalog items' },
  { code: 'item.create', resource: 'item', action: 'create', description: 'Create new products and items' },
  { code: 'item.update', resource: 'item', action: 'update', description: 'Update product general specifications' },
  { code: 'item.change_price', resource: 'item', action: 'change_price', description: 'Change product selling prices' },
  { code: 'item.change_cost', resource: 'item', action: 'change_cost', description: 'Change product reference costs' },
  { code: 'item.delete', resource: 'item', action: 'delete', description: 'Permanently delete unreferenced products' },
  { code: 'item.archive', resource: 'item', action: 'archive', description: 'Archive products without deleting historical data' },
  { code: 'item.restore', resource: 'item', action: 'restore', description: 'Restore archived products' },
  { code: 'item.export', resource: 'item', action: 'export', description: 'Export products catalog' },

  // Categories
  { code: 'category.view', resource: 'category', action: 'view', description: 'View catalog categories' },
  { code: 'category.create', resource: 'category', action: 'create', description: 'Create new category' },
  { code: 'category.update', resource: 'category', action: 'update', description: 'Update category details' },
  { code: 'category.delete', resource: 'category', action: 'delete', description: 'Delete empty categories' },

  // Units of Measure
  { code: 'uom.view', resource: 'uom', action: 'view', description: 'View units of measure' },
  { code: 'uom.create', resource: 'uom', action: 'create', description: 'Create units of measure' },
  { code: 'uom.update', resource: 'uom', action: 'update', description: 'Update units of measure' },

  // Media & Files Centralized Management
  { code: 'media.upload', resource: 'media', action: 'upload', description: 'Upload product and entity images/files' },
  { code: 'media.view', resource: 'media', action: 'view', description: 'View media files' },
  { code: 'media.replace', resource: 'media', action: 'replace', description: 'Replace media files' },
  { code: 'media.delete', resource: 'media', action: 'delete', description: 'Delete media files' },

  // Operational Documents (Approval & Cancellation)
  { code: 'sales.create', resource: 'sales', action: 'create', description: 'Create sales orders' },
  { code: 'sales.cancel', resource: 'sales', action: 'cancel', description: 'Cancel sales orders' },
  { code: 'sales.refund', resource: 'sales', action: 'refund', description: 'Process sales refunds' },
  { code: 'purchase.create', resource: 'purchase', action: 'create', description: 'Create purchase orders' },
  { code: 'purchase.approve', resource: 'purchase', action: 'approve', description: 'Approve purchase orders' },
  { code: 'purchase.cancel', resource: 'purchase', action: 'cancel', description: 'Cancel purchase orders' },
  { code: 'journal.create', resource: 'journal', action: 'create', description: 'Create draft journal entries' },
  { code: 'journal.post', resource: 'journal', action: 'post', description: 'Post and lock journal entries' },
  { code: 'journal.reverse', resource: 'journal', action: 'reverse', description: 'Reverse posted journal entries' },
];

const SYSTEM_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'مدير عام النظام (Super Admin)',
    permissions: ['*'],
  },
  {
    code: 'COMPANY_ADMIN',
    name: 'مدير الشركة (Company Admin)',
    permissions: [
      'legal_entity.read', 'legal_entity.create', 'legal_entity.update', 'legal_entity.delete',
      'branch.read', 'branch.create', 'branch.update', 'branch.archive',
      'user.read', 'user.create', 'user.update', 'user.delete',
      'role.read', 'role.create', 'role.update', 'role.delete',
      'tenant.read', 'tenant.update',
      'audit.read',
      'device.register',
      'item.view', 'item.create', 'item.update', 'item.change_price', 'item.change_cost', 'item.delete', 'item.archive', 'item.restore', 'item.export',
      'category.view', 'category.create', 'category.update', 'category.delete',
      'uom.view', 'uom.create', 'uom.update',
      'media.upload', 'media.view', 'media.replace', 'media.delete',
      'sales.create', 'sales.cancel', 'sales.refund',
      'purchase.create', 'purchase.approve', 'purchase.cancel',
      'journal.create', 'journal.post', 'journal.reverse',
    ],
  },
  {
    code: 'BRANCH_MANAGER',
    name: 'مدير فرع (Branch Manager)',
    permissions: [
      'branch.read', 'branch.update',
      'user.read',
      'item.view', 'item.create', 'item.update', 'item.change_price', 'item.archive',
      'category.view', 'uom.view',
      'media.upload', 'media.view',
      'sales.create', 'sales.cancel', 'sales.refund',
      'purchase.create',
    ],
  },
  {
    code: 'EMPLOYEE',
    name: 'موظف (Employee)',
    permissions: [
      'branch.read',
      'item.view',
      'category.view',
      'sales.create',
      'media.view',
    ],
  },
];

async function seed() {
  console.log('--- Seeding System Permissions & Roles into restaurant_cloud_staging ---');
  const sql = postgres(url, { max: 1 });

  try {
    // 1. Insert or update permissions
    const permMap = new Map();
    for (const p of SYSTEM_PERMISSIONS) {
      const [record] = await sql`
        INSERT INTO permissions (code, resource, action, description)
        VALUES (${p.code}, ${p.resource}, ${p.action}, ${p.description})
        ON CONFLICT (code) DO UPDATE
          SET description = EXCLUDED.description
        RETURNING id, code;
      `;
      permMap.set(record.code, record.id);
    }
    console.log(`[OK] Seeded ${permMap.size} system permissions.`);

    // 2. Insert or update system roles (tenant_id IS NULL)
    for (const r of SYSTEM_ROLES) {
      let [role] = await sql`
        SELECT id FROM roles WHERE code = ${r.code} AND tenant_id IS NULL LIMIT 1;
      `;

      if (!role) {
        [role] = await sql`
          INSERT INTO roles (code, name, is_system_role, tenant_id)
          VALUES (${r.code}, ${r.name}, true, NULL)
          RETURNING id;
        `;
        console.log(`[OK] Created system role: ${r.code}`);
      } else {
        await sql`
          UPDATE roles SET name = ${r.name}, is_system_role = true
          WHERE id = ${role.id};
        `;
      }

      // Link role permissions
      for (const pCode of r.permissions) {
        const permId = permMap.get(pCode);
        if (permId) {
          await sql`
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (${role.id}, ${permId})
            ON CONFLICT DO NOTHING;
          `;
        }
      }
    }

    console.log('[SUCCESS] All granular system permissions and roles successfully seeded.');
  } finally {
    await sql.end();
  }
}

seed().catch(err => {
  console.error('[FAILED] Seeding failed:', err);
  process.exit(1);
});
