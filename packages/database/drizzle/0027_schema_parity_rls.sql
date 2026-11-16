ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "table_id" uuid;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "notes" text;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND pc.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
        'tenant_isolation_' || r.table_name,
        r.table_name
      );
    END IF;
  END LOOP;
END $$;
