-- Narrow what app_user can do on tables that do not need broad access.
--
-- notifications: the API only marks them read; every other column is written on insert.
REVOKE UPDATE ON "notifications" FROM app_user;--> statement-breakpoint
GRANT UPDATE ("read_at") ON "notifications" TO app_user;--> statement-breakpoint

-- sessions and users: authentication goes through the owner pool (systemDb), so app_user gets
-- no access to sessions and, on users, only the public columns for read (no password_hash,
-- no writes).
REVOKE ALL ON "sessions" FROM app_user;--> statement-breakpoint
REVOKE ALL ON "users" FROM app_user;--> statement-breakpoint
GRANT SELECT ("id", "email", "name", "is_demo", "created_at") ON "users" TO app_user;
