-- Second barrier for the mailbox: the API (app_user) only reads it, inside withUserTx, and the
-- policy limits it to emails sent to the session user's own address, even without a WHERE.
-- The worker writes it with the owner role (systemDb), which RLS does not filter (ENABLE, not
-- FORCE). Both columns are citext, so the comparison ignores case like the login does.
ALTER TABLE "mailbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mailbox_own" ON "mailbox" FOR SELECT TO app_user
  USING (to_email = (
    select u.email from users u
    where u.id = nullif(current_setting('app.user_id', true), '')::uuid
  ));--> statement-breakpoint
-- demo_state is only read and written by the demo reset (owner role).
REVOKE ALL ON "demo_state" FROM app_user;
