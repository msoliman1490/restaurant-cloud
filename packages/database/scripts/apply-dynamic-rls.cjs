const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const url = process.env.MIGRATIONS_DATABASE_URL;

async function applyDynamicRLS() {
  console.log('--- Applying Dynamic RLS Policies on All Staging Tables ---');
  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  try {
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('__drizzle_migrations', '__schema_migrations');
    `;

    console.log(`Found ${tables.length} tables in staging database.`);

    for (const t of tables) {
      const name = t.table_name;
      // Enable and force RLS
      await sql.unsafe(`ALTER TABLE public."${name}" ENABLE ROW LEVEL SECURITY;`);
      await sql.unsafe(`ALTER TABLE public."${name}" FORCE ROW LEVEL SECURITY;`);

      // Migrator admin policy (allows rc_migrator full access)
      await sql.unsafe(`DROP POLICY IF EXISTS migrator_admin_policy ON public."${name}";`);
      await sql.unsafe(`CREATE POLICY migrator_admin_policy ON public."${name}" FOR ALL TO rc_migrator USING (true) WITH CHECK (true);`);

      // Check if table has tenant_id
      const [hasTenantCol] = await sql`
        SELECT count(*) as count 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = ${name} 
          AND column_name = 'tenant_id';
      `;

      if (name === 'roles') {
        await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation_policy ON public.roles;`);
        await sql.unsafe(`DROP POLICY IF EXISTS roles_read_policy ON public.roles;`);
        await sql.unsafe(`DROP POLICY IF EXISTS roles_write_policy ON public.roles;`);
        await sql.unsafe(`
          CREATE POLICY roles_read_policy ON public.roles
            FOR SELECT
            TO rc_app_user
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid OR tenant_id IS NULL);
        `);
        await sql.unsafe(`
          CREATE POLICY roles_write_policy ON public.roles
            FOR ALL
            TO rc_app_user
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        `);
      } else if (name === 'user_memberships') {
        await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation_policy ON public.user_memberships;`);
        await sql.unsafe(`DROP POLICY IF EXISTS user_memberships_policy ON public.user_memberships;`);
        await sql.unsafe(`
          CREATE POLICY user_memberships_policy ON public.user_memberships
            FOR ALL
            TO rc_app_user
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid OR NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        `);
      } else if (hasTenantCol.count > 0) {
        await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation_policy ON public."${name}";`);
        await sql.unsafe(`
          CREATE POLICY tenant_isolation_policy ON public."${name}"
            FOR ALL
            TO rc_app_user
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        `);
      } else if (name === 'tenants') {
        await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation_policy ON public.tenants;`);
        await sql.unsafe(`DROP POLICY IF EXISTS tenants_insert_policy ON public.tenants;`);
        await sql.unsafe(`DROP POLICY IF EXISTS tenants_select_policy ON public.tenants;`);
        await sql.unsafe(`DROP POLICY IF EXISTS tenants_update_delete_policy ON public.tenants;`);
        await sql.unsafe(`
          CREATE POLICY tenants_insert_policy ON public.tenants
            FOR INSERT
            TO rc_app_user
            WITH CHECK (true);
        `);
        await sql.unsafe(`
          CREATE POLICY tenants_select_policy ON public.tenants
            FOR SELECT
            TO rc_app_user
            USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid OR NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL);
        `);
        await sql.unsafe(`
          CREATE POLICY tenants_update_delete_policy ON public.tenants
            FOR ALL
            TO rc_app_user
            USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
            WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        `);
      } else if (name === 'permissions') {
        await sql.unsafe(`DROP POLICY IF EXISTS global_read_policy ON public.permissions;`);
        await sql.unsafe(`
          CREATE POLICY global_read_policy ON public.permissions
            FOR SELECT
            TO rc_app_user
            USING (true);
        `);
      } else if (name === 'role_permissions') {
        await sql.unsafe(`DROP POLICY IF EXISTS role_permissions_policy ON public.role_permissions;`);
        await sql.unsafe(`
          CREATE POLICY role_permissions_policy ON public.role_permissions
            FOR ALL
            TO rc_app_user
            USING (true)
            WITH CHECK (true);
        `);
      } else if (name === 'users') {
        await sql.unsafe(`DROP POLICY IF EXISTS users_isolation_policy ON public.users;`);
        await sql.unsafe(`
          CREATE POLICY users_isolation_policy ON public.users
            FOR ALL
            TO rc_app_user
            USING (true)
            WITH CHECK (true);
        `);
      } else if (name === 'membership_scopes') {
        await sql.unsafe(`DROP POLICY IF EXISTS membership_scopes_policy ON public.membership_scopes;`);
        await sql.unsafe(`
          CREATE POLICY membership_scopes_policy ON public.membership_scopes
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.user_memberships m 
              WHERE m.id = membership_scopes.membership_id 
                AND m.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.user_memberships m 
              WHERE m.id = membership_scopes.membership_id 
                AND m.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      } else if (name === 'document_sequences') {
        await sql.unsafe(`DROP POLICY IF EXISTS document_sequences_policy ON public.document_sequences;`);
        await sql.unsafe(`
          CREATE POLICY document_sequences_policy ON public.document_sequences
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.legal_entities e 
              WHERE e.id = document_sequences.legal_entity_id 
                AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.legal_entities e 
              WHERE e.id = document_sequences.legal_entity_id 
                AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      } else if (name === 'order_lines') {
        await sql.unsafe(`DROP POLICY IF EXISTS order_lines_policy ON public.order_lines;`);
        await sql.unsafe(`
          CREATE POLICY order_lines_policy ON public.order_lines
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.sales_orders o 
              WHERE o.id = order_lines.order_id 
                AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.sales_orders o 
              WHERE o.id = order_lines.order_id 
                AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      } else if (name === 'journal_lines') {
        await sql.unsafe(`DROP POLICY IF EXISTS journal_lines_policy ON public.journal_lines;`);
        await sql.unsafe(`
          CREATE POLICY journal_lines_policy ON public.journal_lines
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.journal_entries j 
              WHERE j.id = journal_lines.journal_entry_id 
                AND j.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.journal_entries j 
              WHERE j.id = journal_lines.journal_entry_id 
                AND j.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      } else if (name === 'stock_adjustment_lines') {
        await sql.unsafe(`DROP POLICY IF EXISTS stock_adjustment_lines_policy ON public.stock_adjustment_lines;`);
        await sql.unsafe(`
          CREATE POLICY stock_adjustment_lines_policy ON public.stock_adjustment_lines
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.stock_adjustments a 
              WHERE a.id = stock_adjustment_lines.adjustment_id 
                AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.stock_adjustments a 
              WHERE a.id = stock_adjustment_lines.adjustment_id 
                AND a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      } else if (name === 'stock_transfer_lines') {
        await sql.unsafe(`DROP POLICY IF EXISTS stock_transfer_lines_policy ON public.stock_transfer_lines;`);
        await sql.unsafe(`
          CREATE POLICY stock_transfer_lines_policy ON public.stock_transfer_lines
            FOR ALL
            TO rc_app_user
            USING (EXISTS (
              SELECT 1 FROM public.stock_transfers t 
              WHERE t.id = stock_transfer_lines.transfer_id 
                AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ))
            WITH CHECK (EXISTS (
              SELECT 1 FROM public.stock_transfers t 
              WHERE t.id = stock_transfer_lines.transfer_id 
                AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            ));
        `);
      }
    }

    // Grant DML on all tables & sequences
    await sql`GRANT USAGE ON SCHEMA public TO rc_app_user;`;
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;`;
    await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;`;

    // Strictly immutable audit logs
    await sql`REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM rc_app_user;`;

    // Add immutable trigger
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Security Violation: Audit logs are strictly immutable and cannot be modified or deleted.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON public.audit_logs;
      CREATE TRIGGER trg_prevent_audit_log_modification
        BEFORE UPDATE OR DELETE ON public.audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION public.prevent_audit_log_modification();
    `);

    console.log('[SUCCESS] All RLS policies, permissions, and triggers applied successfully.');
  } finally {
    await sql.end();
  }
}

applyDynamicRLS().catch(err => {
  console.error('[FAILED] Could not apply dynamic RLS:', err);
  process.exit(1);
});
