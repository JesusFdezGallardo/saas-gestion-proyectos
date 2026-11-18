-- Row-level security for the runtime role `app_user`.
--
-- Tables are owned by the migration (owner) role. RLS is ENABLEd, not FORCEd: the owner
-- (`systemDb`) keeps doing the documented system operations, while `app_user`, which owns
-- nothing and has no BYPASSRLS, is always filtered by these policies.
--
-- Each transaction of the API sets (SET LOCAL via set_config(..., true)):
--   app.user_id  current user                (withUserTx, withOrgTx)
--   app.org_id   organization of the request (withOrgTx)
-- A missing setting evaluates to NULL, so the predicates match nothing.
--
-- The role itself is created outside migrations (docker init 01-roles.sql / Neon console).

GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;--> statement-breakpoint

-- ------------------------------------------------------------------ tenant tables
-- Plain organization scope: read and write only rows of app.org_id.

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "projects_org" ON "projects" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "columns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "columns_org" ON "columns" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cards_org" ON "cards" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "labels_org" ON "labels" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "card_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "card_labels_org" ON "card_labels" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "comments_org" ON "comments" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mentions_org" ON "mentions" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitations_org" ON "invitations" FOR ALL TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- ------------------------------------------------------------------ memberships
-- Read: rows of app.org_id, plus the user's own rows (to list "my organizations").
-- Write: only inside app.org_id.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" FOR SELECT TO app_user
  USING (
    organization_id = nullif(current_setting('app.org_id', true), '')::uuid
    OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );--> statement-breakpoint
CREATE POLICY "memberships_insert" ON "memberships" FOR INSERT TO app_user
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_update" ON "memberships" FOR UPDATE TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_delete" ON "memberships" FOR DELETE TO app_user
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- ------------------------------------------------------------------ organizations
-- Read: app.org_id or any organization the user is a member of (the subquery is itself
-- filtered by the memberships policy, which allows the user's own rows).
-- Insert: the code pre-generates the id and opens withOrgTx with it.

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "organizations_select" ON "organizations" FOR SELECT TO app_user
  USING (
    id = nullif(current_setting('app.org_id', true), '')::uuid
    OR id IN (
      SELECT m.organization_id FROM memberships m
      WHERE m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );--> statement-breakpoint
CREATE POLICY "organizations_insert" ON "organizations" FOR INSERT TO app_user
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "organizations_update" ON "organizations" FOR UPDATE TO app_user
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "organizations_delete" ON "organizations" FOR DELETE TO app_user
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- ------------------------------------------------------------------ notifications
-- The bell is cross-organization: a user reads/updates/deletes only their own rows.
-- Insert (the actor notifies someone else): only inside app.org_id; the recipient's
-- membership is checked in code. Inserts do not use RETURNING (ids generated in code),
-- because the inserting user cannot SELECT another user's notification.

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_select" ON "notifications" FOR SELECT TO app_user
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_insert" ON "notifications" FOR INSERT TO app_user
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_update" ON "notifications" FOR UPDATE TO app_user
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_delete" ON "notifications" FOR DELETE TO app_user
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

-- ------------------------------------------------------------------ user_settings

ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_settings_own" ON "user_settings" FOR ALL TO app_user
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- No RLS (global or system tables, accessed through systemDb or with explicit WHERE in the
-- auth/mail modules): users, sessions, mailbox, email_quota, email_blocklist, demo_state.
