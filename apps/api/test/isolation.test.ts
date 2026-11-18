/**
 * Tenant isolation battery (design 6.2). Pablo (org B) attacks org A's resources through every
 * route that carries an id, through the realtime room and straight at the database. Nothing of
 * A may change, leak or be reachable.
 *
 * First barrier: the application (`requireOrg` + ids checked against the active org).
 * Second barrier: Row-Level Security with a non-owner role. The direct SQL block exercises the
 * second barrier on its own; the HTTP block exercises the first. Calling `withOrgTx(pablo, orgA)`
 * is deliberately NOT tested: the app layer never lets a non-member reach it.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../src/db/client';
import { mailbox, memberships } from '../src/db/schema';
import { withOrgTx } from '../src/db/tx';
import { closeSocketServer } from '../src/realtime/socket';
import { resetDb, signUp } from './helpers';
import {
  connected,
  joinBoard,
  openSocket,
  startRealtimeApp,
  type Client,
  type RealtimeApp,
} from './socket-helpers';

type User = { cookie: string; userId: string; orgId: string };
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface OrgFixture {
  admin: User;
  member: User;
  projectId: string;
  columnId: string;
  columnId2: string;
  cardId: string;
  labelId: string;
  commentId: string;
  notificationId: string;
  inviteToken: string;
}

let rt: RealtimeApp;
let ana: User;
let pablo: User;
let A: OrgFixture;
let B: OrgFixture;
const sockets: Client[] = [];

const call = (method: Method, url: string, user: User, payload?: object) =>
  rt.app.inject({
    method,
    url,
    headers: { cookie: user.cookie },
    ...(payload ? { payload } : {}),
  });

async function ok<T>(method: Method, url: string, user: User, payload?: object): Promise<T> {
  const res = await call(method, url, user, payload);
  if (res.statusCode >= 300) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.json<T>();
}

/**
 * One org with an admin and a member, and one of everything: project, columns, card, label,
 * comment (by the member, mentioning the admin, so the admin has a notification), invitation
 * and a mailbox entry for the admin.
 */
async function seedOrg(tag: string): Promise<OrgFixture> {
  const admin = await signUp(rt.app, {
    email: `${tag}-admin@x.com`,
    name: `${tag} Admin`,
    orgName: `Org ${tag}`,
  });
  const member = await signUp(rt.app, {
    email: `${tag}-member@x.com`,
    name: `${tag} Member`,
    orgName: `Own ${tag}`,
  });
  await systemDb
    .insert(memberships)
    .values({ organizationId: admin.orgId, userId: member.userId, role: 'member' });
  const org = `/api/orgs/${admin.orgId}`;
  const project = await ok<{ id: string }>('POST', `${org}/projects`, admin, { name: `P ${tag}` });
  const board = await ok<{ columns: Array<{ id: string }> }>(
    'GET',
    `${org}/projects/${project.id}/board`,
    admin,
  );
  const col2 = await ok<{ id: string }>('POST', `${org}/projects/${project.id}/columns`, admin, {
    name: 'Second',
  });
  const columnId = board.columns[0]?.id ?? '';
  const card = await ok<{ id: string }>('POST', `${org}/columns/${columnId}/cards`, admin, {
    title: `Card ${tag}`,
  });
  const label = await ok<{ id: string }>('POST', `${org}/projects/${project.id}/labels`, admin, {
    name: `Label ${tag}`,
    color: '#22c55e',
  });
  await ok('PATCH', `${org}/cards/${card.id}`, admin, { labelIds: [label.id] });
  const comment = await ok<{ id: string }>('POST', `${org}/cards/${card.id}/comments`, member, {
    body: `hola @[${tag} Admin](user:${admin.userId})`,
  });
  const notifs = await ok<Array<{ id: string }>>('GET', '/api/notifications', admin);
  const notificationId = notifs[0]?.id ?? '';
  expect(notificationId).not.toBe('');
  const inv = await ok<{ link: string }>('POST', `${org}/invitations`, admin, {
    email: `${tag}-invitee@x.com`,
  });
  await systemDb.insert(mailbox).values({
    toEmail: `${tag}-admin@x.com`,
    subject: `PRIVATE-${tag}`,
    html: '<p>private</p>',
    text: 'private',
  });
  return {
    admin,
    member,
    projectId: project.id,
    columnId,
    columnId2: col2.id,
    cardId: card.id,
    labelId: label.id,
    commentId: comment.id,
    notificationId,
    inviteToken: inv.link.split('/invitacion/')[1] ?? '',
  };
}

// ------------------------------------------------------------------ snapshots

async function publicTables(): Promise<string[]> {
  const res = await systemDb.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by 1`,
  );
  return res.rows.map((r) => r.tablename);
}

async function hasOrgColumn(table: string): Promise<boolean> {
  const res = await systemDb.execute(
    sql`select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name = 'organization_id'`,
  );
  return res.rows.length > 0;
}

/** Every row of every public table as JSON, sorted: ignores nothing. */
async function fullSnapshot(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of await publicTables()) {
    const res = await systemDb.execute<{ j: string }>(
      sql.raw(`select to_jsonb(t)::text as j from "${t}" t order by 1`),
    );
    out[t] = res.rows.map((r) => r.j);
  }
  return out;
}

/** Only what belongs to org A: tenant rows, its people's settings, its admin's mailbox. */
async function orgASnapshot(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const people = [A.admin.userId, A.member.userId].map((u) => `'${u}'`).join(',');
  const special: Record<string, string> = {
    organizations: `id = '${A.admin.orgId}'`,
    user_settings: `user_id in (${people})`,
    mailbox: `to_email = 'A-admin@x.com'`,
  };
  for (const t of await publicTables()) {
    let cond = special[t];
    if (!cond) {
      if (!(await hasOrgColumn(t))) continue;
      cond = `organization_id = '${A.admin.orgId}'`;
    }
    const res = await systemDb.execute<{ j: string }>(
      sql.raw(`select to_jsonb(t)::text as j from "${t}" t where ${cond} order by 1`),
    );
    out[t] = res.rows.map((r) => r.j);
  }
  return out;
}

// ------------------------------------------------------------------ route table

/**
 * One row per route that takes an id. `route` is the Fastify pattern; its params are filled with
 * ORG A's ids. Pablo (org B) sends each one and must get `status` (404 by default).
 */
interface Row {
  route: string;
  body?: object;
  status?: number;
}

const ROUTES: Row[] = [
  { route: 'GET /api/orgs/:orgId/members' },
  { route: 'PATCH /api/orgs/:orgId/members/:userId', body: { role: 'admin' } },
  { route: 'DELETE /api/orgs/:orgId/members/:userId' },
  { route: 'POST /api/orgs/:orgId/invitations', body: { email: 'evil@x.com' } },
  { route: 'GET /api/orgs/:orgId/projects' },
  { route: 'POST /api/orgs/:orgId/projects', body: { name: 'Injected' } },
  { route: 'PATCH /api/orgs/:orgId/projects/:projectId', body: { name: 'Renamed' } },
  { route: 'DELETE /api/orgs/:orgId/projects/:projectId' },
  { route: 'GET /api/orgs/:orgId/projects/:projectId/board' },
  { route: 'POST /api/orgs/:orgId/projects/:projectId/columns', body: { name: 'Injected' } },
  {
    route: 'POST /api/orgs/:orgId/projects/:projectId/labels',
    body: { name: 'x', color: '#ef4444' },
  },
  { route: 'PATCH /api/orgs/:orgId/columns/:columnId', body: { name: 'Renamed' } },
  { route: 'DELETE /api/orgs/:orgId/columns/:columnId' },
  { route: 'POST /api/orgs/:orgId/columns/:columnId/cards', body: { title: 'Injected' } },
  { route: 'PATCH /api/orgs/:orgId/cards/:cardId', body: { title: 'Renamed' } },
  {
    route: 'POST /api/orgs/:orgId/cards/:cardId/move',
    body: { toColumnId: ':columnId2', beforeId: null, afterId: null },
  },
  { route: 'DELETE /api/orgs/:orgId/cards/:cardId' },
  { route: 'GET /api/orgs/:orgId/cards/:cardId/comments' },
  { route: 'POST /api/orgs/:orgId/cards/:cardId/comments', body: { body: 'Injected' } },
  { route: 'PATCH /api/orgs/:orgId/comments/:commentId', body: { body: 'Edited' } },
  { route: 'DELETE /api/orgs/:orgId/comments/:commentId' },
  { route: 'PATCH /api/orgs/:orgId/labels/:labelId', body: { name: 'Renamed' } },
  { route: 'DELETE /api/orgs/:orgId/labels/:labelId' },
  // Not under /api/orgs/:orgId: the id alone identifies the resource. Ana's notification does
  // not exist for Pablo (RLS and the user filter).
  { route: 'POST /api/notifications/:id/read' },
  // Invitation tokens are bearer secrets by design and the invitee may have no account. Pablo's
  // email differs from the invited one: reading the info is public, accepting is refused (403)
  // and must not create a membership (checked by the snapshots).
  { route: 'GET /api/invitations/:token', status: 200 },
  { route: 'POST /api/invitations/:token/accept', status: 403 },
];

/** Routes with a path parameter, from Fastify's route tree (HEAD ignored). */
function registeredIdRoutes(printed: string): string[] {
  const routes: string[] = [];
  const stack: string[] = [];
  for (const line of printed.split('\n')) {
    const m = /^([ │]*)[├└]── (\S+) \(([^)]*)\)$/.exec(line);
    if (!m) continue;
    const depth = (m[1] ?? '').length / 4;
    const name = m[2] ?? '';
    const parent = depth === 0 ? '' : (stack[depth - 1] ?? '');
    let full: string;
    if (parent === '') full = name.startsWith('/') ? name : `/${name}`;
    else if (parent === '/') full = `/${name}`;
    else full = parent + (name.startsWith('/') ? name : `/${name}`);
    stack[depth] = full;
    stack.length = depth + 1;
    for (const method of (m[3] ?? '').split(', ')) {
      if (method !== 'HEAD' && full.includes('/:')) routes.push(`${method} ${full}`);
    }
  }
  return routes.sort();
}

function fill(template: string, ids: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (whole, key: string) => ids[key] ?? whole);
}

// ------------------------------------------------------------------ setup

beforeAll(async () => {
  await resetDb();
  rt = await startRealtimeApp();
  A = await seedOrg('A');
  B = await seedOrg('B');
  ana = A.admin;
  pablo = B.admin;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  closeSocketServer(rt.io);
  await rt.app.close();
  await closeDb();
});

let before: Record<string, string[]>;
let beforeA: Record<string, string[]>;

describe('route table: Pablo (org B) acting on org A resources', () => {
  it('takes a snapshot of everything before the attack', async () => {
    before = await fullSnapshot();
    beforeA = await orgASnapshot();
    // Not vacuous: A has data in every table that matters.
    for (const t of [
      'projects',
      'columns',
      'cards',
      'labels',
      'card_labels',
      'comments',
      'mentions',
      'notifications',
      'invitations',
      'memberships',
      'organizations',
      'user_settings',
      'mailbox',
    ]) {
      expect(beforeA[t]?.length ?? 0, t).toBeGreaterThan(0);
    }
  });

  it.each(ROUTES.map((r) => [r.route, r] as const))('%s', async (_name, row) => {
    const [method, pattern] = row.route.split(' ') as [Method, string];
    const ids = {
      orgId: A.admin.orgId,
      projectId: A.projectId,
      columnId: A.columnId,
      columnId2: A.columnId2,
      cardId: A.cardId,
      commentId: A.commentId,
      labelId: A.labelId,
      userId: A.member.userId,
      id: A.notificationId,
      token: A.inviteToken,
    };
    const body = row.body ? (JSON.parse(fill(JSON.stringify(row.body), ids)) as object) : undefined;
    const res = await call(method, fill(pattern, ids), pablo, body);
    const expected = row.status ?? 404;
    expect(res.statusCode, res.body).toBe(expected);
    if (expected === 404) {
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
    }
    if (res.statusCode !== 200) {
      for (const secret of [A.cardId, A.projectId, 'Card A', 'Org A', 'A-admin@x.com']) {
        expect(res.body).not.toContain(secret);
      }
    }
  });

  it("404 too through Pablo's own org path with A's child ids, and for a malformed org id", async () => {
    const orgB = `/api/orgs/${B.admin.orgId}`;
    const attempts: Array<[Method, string, object?]> = [
      ['PATCH', `${orgB}/cards/${A.cardId}`, { title: 'x' }],
      ['DELETE', `${orgB}/cards/${A.cardId}`],
      [
        'POST',
        `${orgB}/cards/${A.cardId}/move`,
        { toColumnId: B.columnId, beforeId: null, afterId: null },
      ],
      ['GET', `${orgB}/cards/${A.cardId}/comments`],
      ['POST', `${orgB}/cards/${A.cardId}/comments`, { body: 'x' }],
      ['PATCH', `${orgB}/comments/${A.commentId}`, { body: 'x' }],
      ['DELETE', `${orgB}/comments/${A.commentId}`],
      ['PATCH', `${orgB}/columns/${A.columnId}`, { name: 'x' }],
      ['DELETE', `${orgB}/columns/${A.columnId}`],
      ['POST', `${orgB}/columns/${A.columnId}/cards`, { title: 'x' }],
      ['PATCH', `${orgB}/labels/${A.labelId}`, { name: 'x' }],
      ['DELETE', `${orgB}/labels/${A.labelId}`],
      ['GET', `${orgB}/projects/${A.projectId}/board`],
      ['PATCH', `${orgB}/projects/${A.projectId}`, { name: 'x' }],
      ['DELETE', `${orgB}/projects/${A.projectId}`],
      ['POST', `${orgB}/projects/${A.projectId}/columns`, { name: 'x' }],
      ['POST', `${orgB}/projects/${A.projectId}/labels`, { name: 'x', color: '#ef4444' }],
      ['PATCH', `${orgB}/members/${A.member.userId}`, { role: 'admin' }],
      ['DELETE', `${orgB}/members/${A.member.userId}`],
      ['GET', '/api/orgs/not-a-uuid/members'],
    ];
    for (const [method, url, body] of attempts) {
      const res = await call(method, url, pablo, body);
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(404);
    }
  });

  it('covers every registered route that carries an id', () => {
    const registered = registeredIdRoutes(rt.app.printRoutes({ commonPrefix: false }));
    expect(registered.length).toBeGreaterThan(20);
    expect(registered.some((r) => r.includes(':orgId'))).toBe(true);
    const covered = new Set(ROUTES.map((r) => r.route));
    const missing = registered.filter((r) => !covered.has(r));
    expect(missing, 'routes with an id missing from the isolation table').toEqual([]);
    const stale = [...covered].filter((r) => !registered.includes(r));
    expect(stale, 'table rows for routes that no longer exist').toEqual([]);
  });

  it('left the whole database untouched (every table, nothing ignored)', async () => {
    expect(await fullSnapshot()).toEqual(before);
  });
});

describe('cross references from org B', () => {
  it('create a card in B assigned to Ana (member of A only) gives 422', async () => {
    const res = await call(
      'POST',
      `/api/orgs/${B.admin.orgId}/columns/${B.columnId}/cards`,
      pablo,
      { title: 'x', assigneeId: ana.userId },
    );
    expect(res.statusCode, res.body).toBe(422);
  });

  it('update a B card to assign Ana gives 422', async () => {
    const res = await call('PATCH', `/api/orgs/${B.admin.orgId}/cards/${B.cardId}`, pablo, {
      assigneeId: ana.userId,
    });
    expect(res.statusCode, res.body).toBe(422);
  });

  it("a card in B with A's label gives 422 and no card_labels row crosses over", async () => {
    const res = await call(
      'POST',
      `/api/orgs/${B.admin.orgId}/columns/${B.columnId}/cards`,
      pablo,
      { title: 'x', labelIds: [A.labelId] },
    );
    expect(res.statusCode, res.body).toBe(422);
    const leaked = await systemDb.execute(
      sql`select 1 from card_labels where label_id = ${A.labelId} and organization_id <> ${A.admin.orgId}`,
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("move B's card into A's column gives 404 and the card stays in B", async () => {
    const res = await call('POST', `/api/orgs/${B.admin.orgId}/cards/${B.cardId}/move`, pablo, {
      toColumnId: A.columnId,
      beforeId: null,
      afterId: null,
    });
    expect(res.statusCode, res.body).toBe(404);
    const row = await systemDb.execute<{ column_id: string }>(
      sql`select column_id from cards where id = ${B.cardId}`,
    );
    expect(row.rows[0]?.column_id).toBe(B.columnId);
  });

  it("move with A's card as neighbour never leaves B and never 500s", async () => {
    const res = await call('POST', `/api/orgs/${B.admin.orgId}/cards/${B.cardId}/move`, pablo, {
      toColumnId: B.columnId,
      beforeId: A.cardId,
      afterId: null,
    });
    expect(res.statusCode, res.body).toBeLessThan(500);
    const row = await systemDb.execute<{ column_id: string; organization_id: string }>(
      sql`select column_id, organization_id from cards where id = ${B.cardId}`,
    );
    expect(row.rows[0]).toMatchObject({ column_id: B.columnId, organization_id: B.admin.orgId });
  });

  it('mention Ana in a B comment: saved as text, no mention row, no notification for Ana', async () => {
    const notifsBefore = await systemDb.execute(
      sql`select id from notifications where user_id = ${ana.userId} order by id`,
    );
    const res = await call('POST', `/api/orgs/${B.admin.orgId}/cards/${B.cardId}/comments`, pablo, {
      body: `hey @[Ana](user:${ana.userId})`,
    });
    expect(res.statusCode, res.body).toBe(201);
    const commentId = res.json<{ id: string }>().id;
    const rows = await systemDb.execute(
      sql`select 1 from mentions where comment_id = ${commentId}`,
    );
    expect(rows.rows).toHaveLength(0);
    const notifsAfter = await systemDb.execute(
      sql`select id from notifications where user_id = ${ana.userId} order by id`,
    );
    expect(notifsAfter.rows).toEqual(notifsBefore.rows);
    const forComment = await systemDb.execute(
      sql`select 1 from notifications where comment_id = ${commentId}`,
    );
    expect(forComment.rows).toHaveLength(0);
  });

  it("board:join of A's project is refused, with A's org or with B's", async () => {
    const socket = openSocket(rt.baseUrl, { cookie: pablo.cookie });
    sockets.push(socket);
    await connected(socket);
    expect(await joinBoard(socket, A.admin.orgId, A.projectId)).toMatchObject({ ok: false });
    expect(await joinBoard(socket, B.admin.orgId, A.projectId)).toMatchObject({ ok: false });
    // Control: his own board works, so the refusals are not a broken socket.
    expect(await joinBoard(socket, B.admin.orgId, B.projectId)).toMatchObject({ ok: true });
  });

  it("Pablo's GET /api/mailbox never returns Ana's emails", async () => {
    const res = await call('GET', '/api/mailbox', pablo);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('PRIVATE-A');
    expect(res.body).not.toContain('A-admin@x.com');
    expect(res.body).toContain('PRIVATE-B'); // control: his own mail is there
    expect((await call('GET', '/api/mailbox', ana)).body).toContain('PRIVATE-A');
  });

  it("Pablo's GET /api/notifications contains no row of org A", async () => {
    const res = await call('GET', '/api/notifications', pablo);
    expect(res.statusCode).toBe(200);
    for (const secret of [
      A.admin.orgId,
      A.cardId,
      A.projectId,
      A.commentId,
      A.notificationId,
      ana.userId,
    ]) {
      expect(res.body).not.toContain(secret);
    }
    expect(res.body).toContain(B.notificationId);
  });

  it("org A's data is exactly as before the whole battery", async () => {
    expect(await orgASnapshot()).toEqual(beforeA);
  });
});

describe('database level: app_user with app.org_id = B (second barrier)', () => {
  const RLS_TABLES = [
    'card_labels',
    'cards',
    'columns',
    'comments',
    'invitations',
    'labels',
    'memberships',
    'mentions',
    'notifications',
    'organizations',
    'projects',
    'user_settings',
  ];

  async function rlsTables(): Promise<string[]> {
    const rls = await systemDb.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and rowsecurity order by 1`,
    );
    return rls.rows.map((r) => r.tablename);
  }

  it('every table with organization_id has RLS enabled, and none is missing from the list', async () => {
    const rls = new Set(await rlsTables());
    for (const t of await publicTables()) {
      if (await hasOrgColumn(t))
        expect(rls.has(t), `${t} has organization_id but no RLS`).toBe(true);
    }
    expect([...rls].sort()).toEqual(RLS_TABLES);
  });

  it('no tenant table returns a row of org A (or of its people) to Pablo scoped to B', async () => {
    const aPeople = [A.admin.userId, A.member.userId];
    await withOrgTx(pablo.userId, B.admin.orgId, async ({ tx }) => {
      for (const tablename of await rlsTables()) {
        const all = await tx.execute<{ j: string }>(
          sql.raw(`select to_jsonb(t)::text as j from "${tablename}" t`),
        );
        // Not vacuous: his own organization's rows are visible.
        expect(all.rows.length, `${tablename}: visible rows`).toBeGreaterThan(0);
        for (const { j } of all.rows) {
          const row = JSON.parse(j) as Record<string, string>;
          // Compare columns, not text: Pablo's own comment may quote Ana's id as plain text.
          if ('organization_id' in row)
            expect(row.organization_id, tablename).not.toBe(A.admin.orgId);
          if (tablename === 'organizations') expect(row.id).not.toBe(A.admin.orgId);
          if ('user_id' in row) expect(aPeople, tablename).not.toContain(row.user_id);
        }
      }
    });
  });

  it('cannot write into org A, and updates/deletes of A rows match nothing', async () => {
    await expect(
      withOrgTx(pablo.userId, B.admin.orgId, ({ tx }) =>
        tx.execute(
          sql`insert into projects (organization_id, name) values (${A.admin.orgId}, 'sneaky')`,
        ),
      ),
    ).rejects.toThrow();
    await withOrgTx(pablo.userId, B.admin.orgId, async ({ tx }) => {
      const upd = await tx.execute(
        sql`update cards set title = 'pwned' where id = ${A.cardId} returning id`,
      );
      const del = await tx.execute(sql`delete from cards where id = ${A.cardId} returning id`);
      expect(upd.rows).toHaveLength(0);
      expect(del.rows).toHaveLength(0);
    });
    expect(await orgASnapshot()).toEqual(beforeA);
  });
});

// Last on purpose: Ana edits a card here, which legitimately changes org A.
describe('realtime events', () => {
  it('Pablo receives no event from A after a refused join', async () => {
    const socket = openSocket(rt.baseUrl, { cookie: pablo.cookie });
    sockets.push(socket);
    await connected(socket);
    const received: unknown[] = [];
    socket.on('board:event', (e) => received.push(e));
    socket.on('user:event', (e) => received.push(e));
    await joinBoard(socket, A.admin.orgId, A.projectId);
    await call('PATCH', `/api/orgs/${A.admin.orgId}/cards/${A.cardId}`, ana, {
      title: 'Ana edits',
    });
    // Round trip on the same connection: anything emitted before it has been delivered.
    await joinBoard(socket, A.admin.orgId, A.projectId);
    expect(received).toEqual([]);
  });
});
