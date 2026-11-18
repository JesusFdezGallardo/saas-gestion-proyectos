-- Runtime role of the API: logs in, owns nothing, cannot bypass RLS.
-- Roles are cluster-wide, so one role serves both databases (kanban and kanban_test).
-- Table privileges are granted by the migrations (0001_rls.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE kanban TO app_user;
GRANT CONNECT ON DATABASE kanban_test TO app_user;
