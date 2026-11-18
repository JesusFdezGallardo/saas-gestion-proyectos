-- Mail tables are written only by the worker (owner pool, `systemDb`). The API role just reads
-- the mailbox (`GET /api/mailbox`, always filtered by the session user's email).
REVOKE ALL ON "mailbox" FROM app_user;--> statement-breakpoint
GRANT SELECT ON "mailbox" TO app_user;--> statement-breakpoint
REVOKE ALL ON "email_quota" FROM app_user;--> statement-breakpoint
REVOKE ALL ON "email_blocklist" FROM app_user;
