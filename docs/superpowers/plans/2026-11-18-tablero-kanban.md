# Tablero Kanban en tiempo real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-tenant Kanban SaaS (course + portfolio piece) with drag & drop, configurable columns, real-time sync over WebSockets, comments with @mentions, in-app + email notifications, and a free public demo.

**Architecture:** pnpm monorepo. `apps/api` (Fastify + Socket.IO + Drizzle + pg-boss) also serves the built `apps/web` (React + Vite) from the same origin, deployed as one Render free web service against Neon Postgres. Tenant isolation is enforced twice: org-membership middleware in the API and Postgres Row-Level Security for the non-owner app role. Writes go through REST; after commit the API emits the full updated entity to Socket.IO rooms.

**Tech Stack:** TypeScript, Node ≥ 24 LTS, pnpm ≥ 10, React 19 + Vite + Tailwind 4 + TanStack Query + React Router + dnd-kit, Fastify 5 + Socket.IO 4, Drizzle ORM + drizzle-kit, PostgreSQL 17, pg-boss, argon2, Zod, Nodemailer, fractional-indexing, Vitest, Testing Library, Playwright, GitHub Actions, Render, Neon, Brevo SMTP. Use the latest stable version of each at build time.

**Spec:** `docs/superpowers/specs/2026-11-18-tablero-kanban-design.md` (Spanish). Executors read both.

## Global Constraints

- 0 € total: only free tiers (Render free web service, Neon free, Brevo free 300/day). No paid service, no domain.
- UI text and README in **Spanish**; code identifiers, DB names, commit messages in English.
- No secrets in the repo; every variable listed in `.env.example`.
- Real-time must be WebSockets (Socket.IO). No polling anywhere for board/notification sync.
- Writes go through REST only; sockets are server→client except `board:join` / `board:leave`.
- Events are emitted **only after the DB transaction commits**, and carry the full updated entity.
- Every tenant table has `organization_id uuid not null`; the API's DB role (`app_user`) does not own tables; RLS enabled on every tenant table.
- Another org's resource → **404** (never reveal existence). Insufficient role or demo-protected action → **403**. No session → **401**. Validation → **422**. Business conflict (e.g. last column) → **409**. Error body: `{ "error": { "code": string, "message": string } }`.
- Comment bodies and all user text rendered escaped (no HTML, no Markdown).
- Mention token format: `@[Display Name](user:<uuid>)`.
- Email: every email is stored in `mailbox` (by recipient email). Real delivery only if `MAIL_TRANSPORT` is `brevo`/`smtp` **and** recipient is not a demo user **and** the triggering actor is not a demo user. Limits: 10 real emails/day per recipient address, 10 invitations/day per inviting user, 250 real emails/day total. 3 attempts with backoff. Footer with unsubscribe link.
- Demo users (`users.is_demo = true`) cannot delete projects, remove members or change roles (403 `demo_protected`).
- Demo data resets when last reset > 24 h: checked on server start and every hour; also `POST /internal/demo/reset` with `Authorization: Bearer $DEMO_RESET_TOKEN`.
- Invitations expire after 7 days; acceptance requires the logged-in account email to equal the invited email (case-insensitive).
- Session cookie `sid`: `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day sliding expiry; mutating requests must have `Origin` equal to `APP_ORIGIN`.

## Review Focus

1. **Member removed while their board tab is open** → they stop receiving that org's events immediately (sockets leave `org:<orgId>:*` rooms). Test in Task 7.
2. **Move with stale neighbours** (the `beforeId`/`afterId` card was moved or deleted meanwhile, or belongs to another column) → server ignores invalid neighbours and places the card at the end of the target column; never 500. Test in Task 6.
3. **Card deleted while another user has it open in the modal** → modal closes with a toast "La tarjeta se ha borrado", no crash. Test in Task 9 (`applyEvent` + modal).
4. **Forged mention token** of a non-member / other-org user, or HTML in a comment → no mention row, no notification, text shown literally. Test in Task 11.
5. **Server sleeps or demo resets while a tab is open** → on socket reconnect or `demo:reset` the client refetches; if the session no longer exists it goes to `/entrar` once (no reload loop). Test in Task 15.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc
docker-compose.yml            # postgres:17 (+ mailpit profile "mail")
.env.example, render.yaml, README.md
.github/workflows/ci.yml
packages/shared/src/
  schemas.ts      # Zod inputs + DTO types
  events.ts       # ServerToClientEvents / ClientToServerEvents
  mentions.ts     # parseMentionIds, toSegments
  positions.ts    # positionBetween
  errors.ts       # ErrorCode union
apps/api/src/
  server.ts                 # entry: build app, start, schedulers
  app.ts                    # buildApp(deps): FastifyInstance
  config.ts                 # env parsing with Zod
  db/schema.ts, db/client.ts (appDb, systemDb), db/tx.ts
  db/migrations/            # drizzle-kit output + 0001_rls.sql
  http/errors.ts, http/auth-guard.ts, http/org-guard.ts, http/origin-check.ts
  realtime/bus.ts, realtime/socket.ts
  modules/auth/, orgs/, invitations/, projects/, columns/, cards/, labels/,
          comments/, notifications/, mail/, demo/    # each: routes.ts + service.ts
apps/api/test/  helpers.ts + <module>.test.ts + isolation.test.ts + system-db-usage.test.ts
apps/web/src/
  main.tsx, App.tsx, lib/{api,socket,queryClient}.ts
  features/auth, orgs, board, comments, notifications, mailbox, settings
apps/web/test/   applyEvent.test.ts, MentionInput.test.tsx
e2e/             playwright.config.ts, realtime.spec.ts, mentions.spec.ts, columns.spec.ts
```

**Core interfaces (defined in Tasks 1–3, used everywhere):**

```ts
// apps/api/src/db/tx.ts
type Tx = /* drizzle transaction */;
interface TxCtx { tx: Tx; afterCommit(fn: () => void | Promise<void>): void }
withUserTx<T>(userId: string, fn: (c: TxCtx) => Promise<T>): Promise<T>        // SET LOCAL app.user_id
withOrgTx<T>(userId: string, orgId: string, fn: (c: TxCtx) => Promise<T>): Promise<T> // + app.org_id
// apps/api/src/realtime/bus.ts
interface RealtimeBus {
  toBoard(orgId: string, projectId: string, event: BoardEvent): void   // room org:<orgId>:board:<projectId>
  toUser(userId: string, event: UserEvent): void                       // room user:<userId>
  removeUserFromOrg(userId: string, orgId: string): Promise<void>
  broadcast(event: 'demo:reset'): void
}
// apps/api/src/app.ts
buildApp(deps: { config: Config; bus: RealtimeBus; mail: MailTransport }): Promise<FastifyInstance>
// apps/api/test/helpers.ts
createTestApp(overrides?): Promise<{ app; bus: RecordingBus; mail: RecordingTransport }>
resetDb(): Promise<void>
signUp(app, { email, name?, orgName? }): Promise<{ cookie: string; userId: string; orgId: string }>
```

Request handlers read `req.user` (`{ id, email, name, isDemo }`, set by auth-guard) and `req.org` (`{ id, role }`, set by org-guard from `:orgId`). The `X-Client-Mutation-Id` header is copied into every emitted event's `meta.clientMutationId`; `meta.actorId` is always set.

---

### Task 1: Monorepo, tooling, shared helpers, CI skeleton

**Files:**
- Create: root config files listed above, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/shared/src/{positions,mentions,errors,index}.ts`
- Test: `packages/shared/test/positions.test.ts`, `packages/shared/test/mentions.test.ts`

**Interfaces:**
- Produces: `positionBetween(before: string | null, after: string | null): string` (wraps `generateKeyBetween`); `parseMentionIds(body: string): string[]` (unique ids, order of appearance); `toSegments(body: string): Array<{ type: 'text'; text: string } | { type: 'mention'; userId: string; name: string }>`; `MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([0-9a-f-]{36})\)/g`; `type ErrorCode = 'unauthenticated' | 'forbidden' | 'demo_protected' | 'not_found' | 'validation' | 'conflict' | 'rate_limited'`.

- [ ] **Step 1: Scaffold** pnpm workspace (`apps/*`, `packages/*`), strict TS base config, ESLint flat config + Prettier, root scripts `typecheck`, `lint`, `test`, `build`, `dev`. `docker-compose.yml`: `postgres:17` on 5432 (user/pass `postgres`, db `kanban`, plus `kanban_test`), `axllent/mailpit` under profile `mail` (SMTP 1025, UI 8025). `.env.example` lists: `DATABASE_URL`, `DATABASE_URL_OWNER`, `SESSION_SECRET`, `APP_ORIGIN`, `MAIL_TRANSPORT` (`none|smtp|brevo`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `DEMO_MODE`, `DEMO_RESET_TOKEN`, `UNSUBSCRIBE_SECRET`.
- [ ] **Step 2: Write failing tests**

```ts
it('positionBetween orders keys', () => {
  const a = positionBetween(null, null), b = positionBetween(a, null), m = positionBetween(a, b);
  expect(a < m && m < b).toBe(true);
});
it('parseMentionIds returns unique ids in order', () => {
  const u1 = '11111111-1111-1111-1111-111111111111', u2 = '22222222-2222-2222-2222-222222222222';
  expect(parseMentionIds(`hola @[Ana](user:${u1}) y @[Luis](user:${u2}) @[Ana](user:${u1})`)).toEqual([u1, u2]);
});
it('toSegments keeps html as plain text', () => {
  expect(toSegments('<b>x</b>')).toEqual([{ type: 'text', text: '<b>x</b>' }]);
});
it('ignores malformed tokens', () => { expect(parseMentionIds('@[Ana](user:nope)')).toEqual([]); });
```

- [ ] **Step 3: Run** `pnpm --filter shared test` → FAIL (not defined).
- [ ] **Step 4: Implement** the three helpers.
- [ ] **Step 5: Run** `pnpm --filter shared test` → PASS; `pnpm typecheck && pnpm lint` → exit 0.
- [ ] **Step 6: CI** `ci.yml` on push/PR: Node 24, pnpm cache, `postgres:17` service, then `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`. (E2E job is added in Task 17.)
- [ ] **Step 7: Commit** `chore: monorepo scaffold and shared helpers`.

### Task 2: Database schema, migrations, roles and RLS

**Files:**
- Create: `apps/api/src/config.ts`, `apps/api/src/db/{schema,client,tx}.ts`, `apps/api/drizzle.config.ts`, `apps/api/src/db/migrations/0001_rls.sql`, `apps/api/db/init/01-roles.sql`
- Test: `apps/api/test/rls.test.ts`, `apps/api/test/helpers.ts` (DB part: `resetDb`)

**Interfaces:**
- Produces: `withUserTx`, `withOrgTx`, `TxCtx` (see Core interfaces); `appDb` (pool on `DATABASE_URL`, role `app_user`); `systemDb` (pool on `DATABASE_URL_OWNER`); `loadConfig(env): Config`.

Tables (uuid PKs `gen_random_uuid()`, `created_at timestamptz default now()`):
`users(email citext unique, name, password_hash null, is_demo bool default false)`, `sessions(id text pk = sha256 of token, user_id, expires_at)`, `organizations(name, is_demo bool)`, `memberships(organization_id, user_id, role 'admin'|'member', unique(org,user))`, `invitations(organization_id, email citext, token_hash unique, invited_by, expires_at, accepted_at null)`, `projects(organization_id, name)`, `columns(organization_id, project_id, name, position text)`, `cards(organization_id, project_id, column_id, title, description text default '', assignee_id null, due_date date null, position text, created_by)`, `labels(organization_id, project_id, name, color)`, `card_labels(organization_id, card_id, label_id, pk(card,label))`, `comments(organization_id, card_id, author_id, body, edited_at null)`, `mentions(organization_id, comment_id, user_id, unique(comment,user))`, `notifications(organization_id, user_id, type 'mention'|'assigned'|'comment', actor_id, card_id, comment_id null, read_at null)`, `user_settings(user_id pk, email_notifications bool default true)`, `mailbox(to_email citext, subject, html, text, status 'stored'|'sent'|'skipped_demo'|'skipped_limit'|'skipped_blocked'|'failed', created_at)`, `email_quota(day date, scope 'recipient'|'inviter'|'global', key text, count int, pk(day,scope,key))`, `email_blocklist(email citext pk)`, `demo_state(id int pk default 1, last_reset_at timestamptz)`. FKs `on delete cascade` from children to parents; `cards.assignee_id on delete set null`. Indexes on `(organization_id)`, `(column_id, position)`, `(user_id, read_at)`.

**RLS (`0001_rls.sql`)** — decision: tables owned by the migration owner, `ENABLE ROW LEVEL SECURITY` (not FORCE; deviation from spec §6.2 so the owner-role `systemDb` can do the documented system operations; `app_user` is not owner, so RLS always applies to it). Policies for `app_user`:
- Tenant tables (`projects, columns, cards, labels, card_labels, comments, mentions, invitations`): `USING/WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)`.
- `memberships`: same org predicate **OR** `user_id = app.user_id` (to list the user's orgs).
- `organizations`: `id = app.org_id OR id IN (select organization_id from memberships where user_id = app.user_id)`.
- `notifications`: `user_id = app.user_id` (bell is cross-org) **AND** for INSERT `organization_id = app.org_id`.
- `user_settings`: `user_id = app.user_id`.
- No RLS on `users` (only email/name; reads go through membership joins), `sessions`, `mailbox`, `email_quota`, `email_blocklist`, `demo_state` — these are touched only via `systemDb` or by explicit `where` in auth/mail modules.
- `GRANT SELECT, INSERT, UPDATE, DELETE` on all tables to `app_user`.

`01-roles.sql` (docker init): `create role app_user login password 'app_user'` for both DBs. README documents the same for Neon.

- [ ] **Step 1: Write failing tests** in `rls.test.ts` (seed two orgs with `systemDb`, then query with `appDb`):

```ts
it('app_user sees only rows of app.org_id', async () => {
  const rows = await withOrgTx(userA, orgA, ({ tx }) => tx.select().from(projects));
  expect(rows.map(r => r.organizationId)).toEqual([orgA]);
});
it('app_user without app.org_id sees no tenant rows', async () => {
  expect(await withUserTx(userA, ({ tx }) => tx.select().from(cards))).toHaveLength(0);
});
it('app_user cannot insert into another org', async () => {
  await expect(withOrgTx(userA, orgA, ({ tx }) => tx.insert(projects).values({ organizationId: orgB, name: 'x' })))
    .rejects.toThrow(/row-level security/);
});
it('afterCommit runs only after commit and not on rollback', async () => { /* spy called once; not called when fn throws */ });
it('app_user is not the owner of tables', async () => { /* pg_tables.tableowner != 'app_user' */ });
```

- [ ] **Step 2: Run** `pnpm --filter api test rls` → FAIL.
- [ ] **Step 3: Implement** schema, `drizzle-kit generate`, hand-written `0001_rls.sql`, `db:migrate` script (uses `DATABASE_URL_OWNER`), `tx.ts` (`SET LOCAL` via `select set_config('app.org_id', $1, true)`; queue `afterCommit` callbacks, run them after the transaction resolves, log and swallow their errors), `resetDb()` = truncate all app tables via `systemDb`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(db): schema, migrations and row-level security`.

### Task 3: App skeleton, auth and sessions

**Files:**
- Create: `apps/api/src/{app,server}.ts`, `http/{errors,auth-guard,origin-check}.ts`, `realtime/bus.ts` (interface + `RecordingBus` for tests), `modules/auth/{routes,service}.ts`, `modules/mail/transport.ts` (interface only + `RecordingTransport`)
- Modify: `packages/shared/src/schemas.ts` (`RegisterInput`, `LoginInput`, `MeDto`)
- Test: `apps/api/test/auth.test.ts`; complete `test/helpers.ts`

**Interfaces:**
- Produces: `POST /api/auth/register {email, name, password(min 8), orgName}` → 201 `MeDto` + cookie (creates user, org, admin membership, user_settings); `POST /api/auth/login` → 200 `MeDto`; `POST /api/auth/logout` → 204; `GET /api/auth/me` → `MeDto = { user: {id,email,name,isDemo}, memberships: {orgId, orgName, role}[] }`; `GET /api/health` → `{ok:true}`. Hooks `requireUser` (sets `req.user`). `sendError(reply, status, code, message)`. `interface MailTransport { send(msg: {to:string; subject:string; html:string; text:string}): Promise<void> }`.

- [ ] **Step 1: Write failing tests**

```ts
it('register sets cookie and returns me with admin membership', ...)  // status 201, set-cookie sid HttpOnly SameSite=Lax, memberships[0].role==='admin'
it('register with existing email → 409 conflict', ...)
it('login wrong password → 401 unauthenticated, same message as unknown email', ...)
it('GET /api/auth/me without cookie → 401', ...)
it('logout deletes session; me afterwards → 401', ...)
it('POST without matching Origin → 403 forbidden', ...)          // Origin: https://evil.example
it('6th failed login in a minute from same IP → 429 rate_limited', ...)
it('invalid body → 422 validation with error.code', ...)
```

- [ ] **Step 2: Run** `pnpm --filter api test auth` → FAIL.
- [ ] **Step 3: Implement** with `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit` (5/min on login and register), argon2id, random 32-byte token in cookie, `sessions.id = sha256(token)`, sliding 30-day expiry. Auth queries use `systemDb` (allowed list, Task 16). Zod errors → 422 via a shared error handler.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): auth and sessions`.

### Task 4: Organizations, members and invitations

**Files:**
- Create: `http/org-guard.ts`, `modules/orgs/{routes,service}.ts`, `modules/invitations/{routes,service}.ts`
- Test: `apps/api/test/orgs.test.ts`, `apps/api/test/invitations.test.ts`

**Interfaces:**
- Consumes: `withOrgTx`, `requireUser`, `RealtimeBus.removeUserFromOrg`.
- Produces: `requireOrg(minRole: 'member' | 'admin')` hook (404 if not member, 403 if role too low); `forbidDemo` hook (403 `demo_protected` when `req.user.isDemo`). Routes: `POST /api/orgs {name}` → 201; `GET /api/orgs/:orgId/members` → `{userId,name,email,role}[]`; `PATCH /api/orgs/:orgId/members/:userId {role}` (admin, forbidDemo); `DELETE /api/orgs/:orgId/members/:userId` (admin, forbidDemo; calls `bus.removeUserFromOrg`); `POST /api/orgs/:orgId/invitations {email}` (admin) → 201 `{ link: string }` where link = `${APP_ORIGIN}/invitacion/<token>`; `GET /api/invitations/:token` → `{orgName, email, expired:boolean}`; `POST /api/invitations/:token/accept` → 200 `MeDto`. Service function `enqueueInvitationEmail(ctx, {...})` is a no-op stub here, wired in Task 13.

- [ ] **Step 1: Write failing tests**

```ts
it('member cannot change roles → 403', ...)
it('cannot remove or demote the last admin → 409 conflict', ...)
it('demo admin cannot remove members → 403 demo_protected', ...)
it('removing a member calls bus.removeUserFromOrg(userId, orgId)', ...)
it('accept with different account email → 403 forbidden', ...)
it('accept expired (>7 days) → 409 conflict', ...)
it('accept twice → second is 409', ...)
it('accept creates membership role member and returns it in me', ...)
it('user of org B calling /api/orgs/<orgA>/members → 404', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Invitation lookup by `token_hash` uses `systemDb` (allowed list). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): organizations, members and invitations`.

### Task 5: Projects and configurable columns

**Files:**
- Create: `modules/projects/{routes,service}.ts`, `modules/columns/{routes,service}.ts`
- Modify: `packages/shared/src/{schemas,events}.ts`
- Test: `apps/api/test/projects.test.ts`, `apps/api/test/columns.test.ts`

**Interfaces:**
- Produces: `GET/POST /api/orgs/:orgId/projects`; `PATCH /api/orgs/:orgId/projects/:projectId {name}`; `DELETE …/projects/:projectId` (admin, forbidDemo); `GET /api/orgs/:orgId/projects/:projectId/board` → `BoardDto = { project, columns: ColumnDto[], cards: CardDto[], labels: LabelDto[], members: MemberDto[] }` sorted by position; `POST /api/orgs/:orgId/projects/:projectId/columns {name}` (appends at end); `PATCH /api/orgs/:orgId/columns/:columnId {name?, beforeId?: string|null, afterId?: string|null}`; `DELETE /api/orgs/:orgId/columns/:columnId?moveTo=<columnId>`.
- `BoardEvent` union in `events.ts` (all with `meta: { actorId: string; clientMutationId?: string }`): `column.created|updated {column}`, `column.deleted {columnId, movedTo?: string, movedCardIds: string[]}`, `card.created|updated|moved {card}`, `card.deleted {cardId}`, `label.created|updated {label}`, `label.deleted {labelId}`, `comment.created|updated {comment}`, `comment.deleted {commentId, cardId}`, `project.updated {project}`, `project.deleted {projectId}`. `UserEvent`: `notification.created {notification}`.

- [ ] **Step 1: Write failing tests**

```ts
it('new project has columns Por hacer, En curso, Hecho in that order', ...)
it('reorder column between two others updates only its position', ...)
it('delete column with cards without moveTo → 409', ...)
it('delete column with moveTo moves cards to the end of target and emits column.deleted with movedCardIds', ...)
it('delete the only column → 409', ...)
it('moveTo a column of another project → 404', ...)
it('every mutation emits after commit to org:<orgId>:board:<projectId> with meta.clientMutationId from header', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (positions via `positionBetween`; neighbours read inside the tx). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): projects and configurable columns`.

### Task 6: Cards and labels (CRUD + move)

**Files:**
- Create: `modules/cards/{routes,service}.ts`, `modules/labels/{routes,service}.ts`
- Test: `apps/api/test/cards.test.ts`, `apps/api/test/labels.test.ts`

**Interfaces:**
- Produces: `POST /api/orgs/:orgId/columns/:columnId/cards {title, description?, assigneeId?, dueDate?, labelIds?}` (appended at end); `PATCH /api/orgs/:orgId/cards/:cardId {title?, description?, assigneeId?: string|null, dueDate?: string|null, labelIds?: string[]}`; `POST /api/orgs/:orgId/cards/:cardId/move {toColumnId, beforeId: string|null, afterId: string|null}` → `CardDto`; `DELETE /api/orgs/:orgId/cards/:cardId`; labels `POST /api/orgs/:orgId/projects/:projectId/labels {name, color}`, `PATCH/DELETE /api/orgs/:orgId/labels/:labelId`. `CardDto = { id, projectId, columnId, title, description, assigneeId, dueDate, position, labelIds, createdBy, commentCount }`. Hook for Task 12: `onAssigneeChanged(ctx, card, previousAssigneeId, actorId)` called from the service (no-op until Task 12).
- Title 1–200 chars, description ≤ 5000, label color one of 8 fixed hex values in `shared/schemas.ts`.

- [ ] **Step 1: Write failing tests**

```ts
it('create, update, delete card emit card.created/updated/deleted', ...)
it('move between columns sets columnId and a position between neighbours', ...)
it('move with stale beforeId (card now in another column) places at end of target, 200', ...)   // Review Focus 2
it('move with deleted afterId places at end, 200', ...)                                          // Review Focus 2
it('assigneeId of a user not in the org → 422 validation', ...)
it('labelIds from another project → 422 validation', ...)
it('toColumnId from another project → 404', ...)
it('deleting a label removes it from cards and emits label.deleted', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): cards and labels`.

### Task 7: Real-time with Socket.IO

**Files:**
- Create: `apps/api/src/realtime/socket.ts`
- Modify: `apps/api/src/server.ts` (attach Socket.IO to Fastify's server, pass `SocketBus` into `buildApp`)
- Test: `apps/api/test/realtime.test.ts` (real server on random port + `socket.io-client`)

**Interfaces:**
- Produces: `createSocketServer(httpServer, deps): { io; bus: RealtimeBus }`. Handshake reads `sid` cookie → 401-style `connect_error` `"unauthenticated"`. On connect join `user:<userId>`. Client events: `board:join ({orgId, projectId}, ack: (r: {ok: true} | {ok: false; code: ErrorCode}) => void)` (checks membership + project in org via `withOrgTx`), `board:leave ({orgId, projectId})`. Room name `org:<orgId>:board:<projectId>`. `removeUserFromOrg` makes the user's sockets leave all rooms starting with `org:<orgId>:`. `broadcast('demo:reset')` emits to all.

- [ ] **Step 1: Write failing tests**

```ts
it('connection without cookie fails with unauthenticated', ...)
it('joining a board of another org → ack {ok:false, code:"not_found"}', ...)
it('Luis receives card.moved when Ana moves a card via REST', ...)
it('event carries meta.clientMutationId sent by Ana', ...)
it('removed member stops receiving events of that org immediately', ...)   // Review Focus 1
it('notification sent toUser reaches only that user', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): realtime board sync over Socket.IO`.

### Task 8: Web app shell, auth and orgs UI

**Files:**
- Create: `apps/web/` (Vite + React + Tailwind), `src/lib/{api,socket,queryClient}.ts`, `src/App.tsx`, `src/features/auth/{LoginPage,RegisterPage}.tsx`, `src/features/orgs/{OrgSwitcher,ProjectsPage,MembersPage,AcceptInvitePage}.tsx`, `src/components/AppLayout.tsx`
- Test: `apps/web/test/api.test.ts`

**Interfaces:**
- Produces: `api<T>(method, path, body?, opts?: { mutationId?: string }): Promise<T>` (credentials include, sends `X-Client-Mutation-Id`, throws `ApiError {status, code, message}`; on 401 redirects to `/entrar` unless already there); `getSocket(): Socket` (connects lazily with credentials, `autoConnect: false`); routes: `/entrar`, `/registro`, `/invitacion/:token`, `/o/:orgId` (projects list), `/o/:orgId/p/:projectId` (board), `/o/:orgId/miembros`, `/buzon`, `/ajustes`. Vite dev proxy `/api` and `/socket.io` → `http://localhost:3000`.

- [ ] **Step 1: Write failing test** `api() throws ApiError with code from body` and `api() sends X-Client-Mutation-Id when given` (mock `fetch`).
- [ ] **Step 2: Run** `pnpm --filter web test` → FAIL. **Step 3: Implement** pages (Spanish copy; sober Tailwind look; mobile-usable). Members page: list, change role, remove, invite form showing the returned link with a "Copiar" button. **Step 4: Run** → PASS; manual: register → see projects page → create project.
- [ ] **Step 5: Commit** `feat(web): app shell, auth and organizations`.

### Task 9: Board UI with drag & drop and real-time

**Files:**
- Create: `src/features/board/{BoardPage,Column,CardItem,CardModal,LabelManager}.tsx`, `src/features/board/{useBoard,useBoardRealtime,applyEvent}.ts`
- Test: `apps/web/test/applyEvent.test.ts`, `apps/web/test/CardModal.test.tsx`

**Interfaces:**
- Consumes: `BoardDto`, `BoardEvent`, `positionBetween`.
- Produces: `applyEvent(board: BoardDto, e: BoardEvent): BoardDto` (pure); `useBoard(orgId, projectId)` (TanStack Query key `['board', projectId]`); `useBoardRealtime(orgId, projectId)` (join on mount, leave on unmount, ignore events whose `meta.clientMutationId` is in the local pending set, on `connect` after a disconnect → `invalidateQueries(['board', projectId])`).
- dnd-kit: sortable columns (horizontal) and sortable cards across columns. Optimistic: on drop compute `beforeId/afterId` from neighbours, update cache with a provisional position, call `/move`; on error restore snapshot and toast "No se pudo mover la tarjeta".

- [ ] **Step 1: Write failing tests**

```ts
it('card.moved moves card to new column and keeps order by position', ...)
it('column.deleted moves movedCardIds into movedTo', ...)
it('card.deleted removes card; unknown ids are ignored', ...)
it('CardModal closes and shows "La tarjeta se ha borrado" when its card disappears', ...)  // Review Focus 3
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** board, column create/rename/reorder/delete (dialog asks target column when it has cards), card create/edit modal (title, description, assignee select, due date, labels), delete with confirmation. **Step 4: Run** → PASS; manual two-window check.
- [ ] **Step 5: Commit** `feat(web): kanban board with drag and drop and realtime`.

### Task 10: Seed, demo login and first deploy

**Files:**
- Create: `modules/demo/{seed,routes,service}.ts`, `apps/web/src/features/auth/DemoButtons.tsx`, `render.yaml`
- Modify: `apps/api/src/app.ts` (serve `apps/web/dist` with `@fastify/static`, SPA fallback for non-`/api` GETs), `LoginPage.tsx`
- Test: `apps/api/test/demo.test.ts`

**Interfaces:**
- Produces: `seedDemo(db = systemDb): Promise<void>` (idempotent after truncate); `resetDemo(): Promise<void>` = truncate all app tables + pg-boss jobs, `seedDemo()`, set `demo_state.last_reset_at = now()`, `bus.broadcast('demo:reset')`; `POST /api/auth/demo-login {email}` → `MeDto` (only `DEMO_MODE=true` and `is_demo` user; else 404); `GET /api/demo/users` → `{email, name, orgName}[]` (DEMO_MODE only); script `pnpm --filter api db:seed-if-empty` (runs `resetDemo()` only when `DEMO_MODE=true` and there are no organizations).
- Seed: org "Estudio Acme" — Ana López (`ana@demo.local`, admin), Luis García (`luis@demo.local`), Marta Ruiz (`marta@demo.local`); projects "Web corporativa" and "Campaña de Navidad" with 3–4 columns, 5 labels, ~12 cards with assignees/dates, 4 comments with mentions, a few notifications. Org "Otra Empresa" — Pablo Sanz (`pablo@demo.local`, admin), project "App interna" with 6 cards. All `is_demo = true`, no password.

- [ ] **Step 1: Write failing tests**: `demo-login disabled when DEMO_MODE=false → 404`; `demo-login for a non-demo user → 404`; `seed creates 2 demo orgs and 4 demo users`; `resetDemo removes a registered non-demo user and broadcasts demo:reset`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; login page shows "Entrar como Ana / Luis / Marta / Pablo" plus the notice "La demo se reinicia cada día; lo que crees se borrará" and "La primera carga puede tardar ~1 minuto".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Deploy** (needs Jesús for account creation; agent prepares everything): Neon project → create role `app_user`; Render web service from `render.yaml` (free plan, build `pnpm install --frozen-lockfile && pnpm build && pnpm --filter api db:migrate && pnpm --filter api db:seed-if-empty`, start `node apps/api/dist/server.js`, health check `/api/health`), env vars from `.env.example` with `MAIL_TRANSPORT=none` for now. Verify: `curl https://<app>.onrender.com/api/health` → `{"ok":true}`; two browsers as Ana/Luis see a card move.
- [ ] **Step 6: Commit** `feat: demo seed, demo login and Render deploy`.

### Task 11: Comments and mentions

**Files:**
- Create: `modules/comments/{routes,service}.ts`
- Test: `apps/api/test/comments.test.ts`

**Interfaces:**
- Produces: `GET /api/orgs/:orgId/cards/:cardId/comments` → `CommentDto[]` (oldest first; `{id, cardId, authorId, authorName, body, createdAt, editedAt}`); `POST …/cards/:cardId/comments {body (1–5000)}`; `PATCH /api/orgs/:orgId/comments/:commentId {body}` and `DELETE` (author only, else 403). Calls `notifyForComment(ctx, {comment, card, newMentionIds, actorId})` (no-op until Task 12). Emits `comment.*` to the board room and `card.updated` (commentCount).
- Valid mention = id from `parseMentionIds` that is a member of the org (query inside `withOrgTx`); others are dropped silently (text kept as is).

- [ ] **Step 1: Write failing tests**

```ts
it('creating a comment stores mention rows only for org members', ...)
it('mention of a user from another org creates no mention row', ...)              // Review Focus 4
it('editing a comment reports only newly added mentions to notifyForComment', ...)
it('non-author edit/delete → 403', ...)
it('body with <script> is stored verbatim and returned verbatim', ...)            // escaping is the web's job
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): comments and mentions`.

### Task 12: In-app notifications

**Files:**
- Create: `modules/notifications/{routes,service}.ts`
- Modify: cards and comments services (replace the no-op hooks)
- Test: `apps/api/test/notifications.test.ts`

**Interfaces:**
- Produces: `createNotifications(ctx, items: {userId, type, actorId, cardId, commentId?}[]): Promise<NotificationDto[]>` (drops `userId === actorId`; after commit `bus.toUser` each `notification.created`; calls `enqueueNotificationEmail(ctx, n)` — no-op until Task 13). Rules: `mention` → each new valid mention; `assigned` → new assignee when it changes; `comment` → card creator and current assignee, **excluding** the author and anyone already getting `mention` for the same comment. `NotificationDto = { id, type, orgId, projectId, cardId, cardTitle, actorName, createdAt, readAt }`.
- Routes (user-scoped, `withUserTx`): `GET /api/notifications?before=<iso>` (20 per page, newest first), `GET /api/notifications/unread-count` → `{count}`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`; `GET/PATCH /api/me/settings {emailNotifications: boolean}`.

- [ ] **Step 1: Write failing tests**

```ts
it('mentioning Luis creates one mention notification for Luis and none for the author', ...)
it('commenting on a card created by Luis and mentioning him gives him only the mention', ...)
it('assigning Marta notifies Marta; reassigning to self notifies nobody', ...)
it('Luis cannot read or mark Ana\'s notification (404)', ...)
it('unread-count drops after read-all', ...)
it('notification.created is emitted to user:<id> only after commit', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): in-app notifications`.

### Task 13: Email queue, mailbox, Brevo and limits

**Files:**
- Create: `modules/mail/{queue,worker,templates,quota,routes}.ts`, `modules/mail/transports/{smtp,none}.ts`
- Modify: `modules/mail/transport.ts`, notifications and invitations services, `server.ts` (start pg-boss + worker in-process)
- Test: `apps/api/test/mail.test.ts`

**Interfaces:**
- Produces: `enqueueEmail(ctx, job: { kind: 'notification' | 'invitation'; toEmail: string; actorId: string; payload: NotificationDto | {orgName, link, inviterName} })` — inserts the pg-boss job **inside the same transaction** (pg-boss `db` option bound to the tx); `enqueueNotificationEmail` skips when recipient's `email_notifications` is false. Worker `handleEmailJob(job)`:
  1. render subject/html/text (`templates.ts`, Spanish; link to the card `${APP_ORIGIN}/o/<org>/p/<project>?card=<id>`; footer + unsubscribe URL `${APP_ORIGIN}/api/mail/unsubscribe?e=<email>&t=<hmac>`);
  2. insert into `mailbox` with status `stored`;
  3. decide real delivery: skip `skipped_demo` if recipient or actor `is_demo` (or recipient email ends in `@demo.local`), `skipped_blocked` if in `email_blocklist`, `skipped_limit` if `quota.tryConsume` fails, else `transport.send` → `sent`; on throw rethrow so pg-boss retries (`retryLimit: 3, retryBackoff: true`); after final failure status `failed`.
- `quota.tryConsume(day, [{scope:'global',key:'all',limit:250},{scope:'recipient',key:email,limit:10}] (+ {scope:'inviter',key:userId,limit:10} for invitations))`: single SQL statement with `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit RETURNING`, all-or-nothing in one tx (atomic under concurrency).
- `createTransport(config): MailTransport` — `none` (no-op), `smtp` (Mailpit locally or Brevo: `smtp-relay.brevo.com:587`, STARTTLS, `MAIL_FROM` = Jesús's verified sender).
- Routes: `GET /api/mailbox` → emails whose `to_email = req.user.email`, newest first, 50 max (`{id, subject, html, text, status, createdAt}`); `GET /api/mail/unsubscribe?e&t` → verifies HMAC (`UNSUBSCRIBE_SECRET`), sets `email_notifications=false` for that user or inserts into `email_blocklist`, returns a small Spanish HTML page.
- Invitations (Task 4 stub) now call `enqueueEmail(kind:'invitation')`; the mailbox is keyed by email, so the invitee sees it after registering with that address.

- [ ] **Step 1: Write failing tests** (worker invoked directly with `RecordingTransport`):

```ts
it('notification email is stored in mailbox and sent for a real user', ...)
it('demo recipient → mailbox only, status skipped_demo, transport not called', ...)
it('real recipient but demo actor → skipped_demo', ...)
it('11th real email to the same address in a day → skipped_limit', ...)
it('11th invitation by the same user in a day → skipped_limit', ...)
it('20 concurrent consumes with limit 10 grant exactly 10', ...)
it('user with emailNotifications=false gets no job', ...)
it('rolled-back transaction enqueues no job', ...)
it('unsubscribe with bad hmac → 400; good hmac disables emails', ...)
it('invited address sees invitation in /api/mailbox after registering', ...)
it('transport failure 3 times → status failed', ...)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual with `docker compose --profile mail up` and `MAIL_TRANSPORT=smtp`: email visible in Mailpit at `http://localhost:8025`.
- [ ] **Step 5: Commit** `feat(api): email queue, mailbox, delivery limits`.

### Task 14: Web — comments, mentions, bell, mailbox, settings

**Files:**
- Create: `src/features/comments/{CommentList,MentionInput}.tsx`, `src/features/notifications/{Bell,useNotifications}.ts(x)`, `src/features/mailbox/MailboxPage.tsx`, `src/features/settings/SettingsPage.tsx`
- Modify: `CardModal.tsx` (comments section; open card from `?card=` param), `AppLayout.tsx` (bell, user menu: "Mi buzón", "Ajustes", "Salir")
- Test: `apps/web/test/MentionInput.test.tsx`, `apps/web/test/CommentList.test.tsx`

**Interfaces:**
- `MentionInput({ members, value, onChange })`: typing `@` opens a filterable list (by name, accent-insensitive); Enter/click inserts `@[Name](user:<id>) `; Escape closes. Displayed in the textarea as the raw token is acceptable; rendered comments use `toSegments`.
- `useNotifications()`: unread count + list via Query; on socket `notification.created` prepend and increment; clicking an item marks read and navigates to `/o/<org>/p/<project>?card=<id>` (switching org if needed).
- Mailbox: list with subject, date, status badge ("Enviado", "Solo buzón (demo)", "Límite diario", "Bloqueado", "Error"); opening an email renders its `html` inside a sandboxed `<iframe sandbox="" srcdoc>`.

- [ ] **Step 1: Write failing tests**: `typing "@lu" shows Luis and Enter inserts the token`; `CommentList renders <script> as text and mentions as highlighted spans` (Review Focus 4).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: Ana mentions Luis, Luis's bell increments live, mailbox shows the email.
- [ ] **Step 5: Commit** `feat(web): comments, mentions, notifications and mailbox`.

### Task 15: Demo protections, daily reset and client recovery

**Files:**
- Create: `modules/demo/scheduler.ts`
- Modify: `server.ts`, project/member routes (`forbidDemo` already from Task 4 — verify on project delete), `apps/web/src/lib/socket.ts`, `useBoardRealtime.ts`, `AppLayout.tsx`
- Test: `apps/api/test/demo-reset.test.ts`, `apps/web/test/socketRecovery.test.ts`

**Interfaces:**
- Produces: `startDemoScheduler({ now = () => new Date(), intervalMs = 3_600_000 })` (only if `DEMO_MODE`): on start and each interval, `if (!last_reset_at || now - last_reset_at > 24h) await resetDemo()`; guarded by `pg_try_advisory_lock(42)` so overlapping runs don't both reset. `POST /internal/demo/reset` with Bearer `DEMO_RESET_TOKEN` (constant-time compare; 401 otherwise).
- Client: on `demo:reset` or on reconnect → call `/api/auth/me`; if 401 navigate once to `/entrar?motivo=reinicio` (show "La demo se ha reiniciado. Vuelve a entrar."); else invalidate all queries. A module-level flag prevents repeated redirects.

- [ ] **Step 1: Write failing tests**: `scheduler resets when last reset is 25 h old and not when 23 h`; `two concurrent scheduler runs reset once`; `reset endpoint without token → 401`; `demo user deleting a project → 403 demo_protected`; web: `after demo:reset with 401 from me, navigates to /entrar once` (Review Focus 5).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: demo protections, daily reset and client recovery`.

### Task 16: Tenant isolation battery

**Files:**
- Create: `apps/api/test/isolation.test.ts`, `apps/api/test/system-db-usage.test.ts`

**Interfaces:**
- Consumes: every route above.

- [ ] **Step 1: Write the battery**: seed org A (Ana) and org B (Pablo) with one project, column, card, label, comment, notification each. As Pablo, table-driven over every A-scoped route (GET board, members; POST column/card/label/comment/invitation; PATCH/move/DELETE card, column, label, comment, project; mark A's notification read) → each returns **404** and A's data is unchanged (compare `systemDb` snapshot before/after). Cross-references while acting in B: create a card in B with `assigneeId` = Ana → 422; move B's card to A's column → 404; mention Ana in a B comment → no mention row; `board:join` A's project → `{ok:false}`. Also direct SQL with `app.org_id = B` returns zero A rows for every tenant table.
- [ ] **Step 2: `system-db-usage.test.ts`**: scans `apps/api/src/**/*.ts` and fails if `systemDb` is imported outside the allowed list: `db/client.ts`, `modules/auth/*`, `modules/invitations/service.ts`, `modules/mail/*`, `modules/demo/*`, `test/*`.
- [ ] **Step 3: Run** `pnpm --filter api test isolation system-db` → PASS (if anything fails, fix the route, not the test).
- [ ] **Step 4: Commit** `test(api): tenant isolation battery`.

### Task 17: End-to-end tests, final deploy and README

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/{realtime,mentions,columns}.spec.ts`, `docs/arquitectura.md` (optional split if README grows)
- Modify: `.github/workflows/ci.yml` (e2e job: build, start API with `DEMO_MODE=true MAIL_TRANSPORT=none`, seed, run Playwright), `README.md`, `render.yaml` (`MAIL_TRANSPORT=brevo`)

- [ ] **Step 1: Write e2e specs** (two browser contexts, demo login):
  - `realtime.spec.ts`: Ana drags a card from "Por hacer" to "En curso"; within 3 s Luis's page shows it in "En curso" without reload.
  - `mentions.spec.ts`: Ana comments mentioning `@Luis`; Luis's bell count increases by 1; in "Mi buzón" a new email with subject containing "te ha mencionado" and status "Solo buzón (demo)".
  - `columns.spec.ts`: Ana creates, renames, reorders and deletes a column (moving its cards); Luis sees each step.
- [ ] **Step 2: Run** `pnpm e2e` → PASS locally; push → CI green.
- [ ] **Step 3: README (Spanish)**: badge CI; demo link + "tarda ~1 min la primera vez"; demo users; the 5-step "Guion de prueba" from spec §9 verbatim in meaning; Mermaid architecture diagram (browser ↔ Fastify REST/Socket.IO ↔ Postgres RLS; pg-boss worker → mailbox/Brevo); how isolation works (two barriers, the `systemDb` allow-list and why RLS is ENABLE not FORCE); local setup (`docker compose up -d`, `pnpm i`, `pnpm --filter api db:migrate`, `pnpm dev`); decisions table (approaches A/B/C); "Qué haría para producción" (Socket.IO Postgres/Redis adapter for multiple instances, own domain + SPF/DKIM, email verification, password reset, backups).
- [ ] **Step 4: Final deploy** with Brevo (Jesús creates the free Brevo account, verifies his sender, puts `SMTP_USER/SMTP_PASS/MAIL_FROM` in Render). Verify on the public URL: health 200; guion steps 1–5 by hand; register with a real address → invitation email arrives in a real inbox.
- [ ] **Step 5: Commit** `docs: README, e2e tests and final deploy`.

---

## Spec coverage map

| Spec | Tasks |
|---|---|
| §5 orgs, roles, invitations | 3, 4, 8 |
| §5 columns configurable | 5, 9 |
| §5 cards CRUD + DnD | 6, 9 |
| §5/§6.4 realtime | 5–7, 9, 15 |
| §5/§6.5 comments + mentions | 11, 14 |
| §5/§6.6 notifications + email + limits | 12, 13, 14 |
| §6.2 multi-tenant two barriers | 2, 4, 16 |
| §6.7 security | 3, 13 (unsubscribe HMAC), 14 (iframe sandbox) |
| §7 tests + CI | every task, 16, 17 |
| §8 deploy, seed, demo, daily reset | 10, 15, 17 |
| §9 guion de prueba | 17 (README + e2e) |
| §10 order / cuts | task order; if short on time cut in this order: org switcher (Task 8), comment edit/delete (Task 11), LabelManager (Task 9), due date |
