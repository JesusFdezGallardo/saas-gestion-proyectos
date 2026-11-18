import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client';
import { createTestApp, resetDb, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  await resetDb();
  t = await createTestApp();
});
afterAll(async () => {
  await t?.app.close();
  await closeDb();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function setup() {
  const u = await signUp(t.app, { email: 'a@x.com' });
  const p = (await call('POST', `/api/orgs/${u.orgId}/projects`, u.cookie, { name: 'P' })).json<{
    id: string;
  }>();
  return { u, projectId: p.id };
}

describe('labels', () => {
  it('creates, updates and deletes a label, emitting events', async () => {
    const { u, projectId } = await setup();
    t.bus.boardEvents.length = 0;
    const created = await call(
      'POST',
      `/api/orgs/${u.orgId}/projects/${projectId}/labels`,
      u.cookie,
      { name: 'Bug', color: '#ef4444' },
    );
    expect(created.statusCode).toBe(201);
    const label = created.json<{ id: string }>();
    expect(created.json()).toMatchObject({ name: 'Bug', color: '#ef4444', projectId });

    const patched = await call('PATCH', `/api/orgs/${u.orgId}/labels/${label.id}`, u.cookie, {
      name: 'Defecto',
      color: '#3b82f6',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ name: 'Defecto', color: '#3b82f6' });

    const del = await call('DELETE', `/api/orgs/${u.orgId}/labels/${label.id}`, u.cookie);
    expect(del.statusCode).toBe(204);
    expect(t.bus.boardEvents.map((e) => e.event.type)).toEqual([
      'label.created',
      'label.updated',
      'label.deleted',
    ]);
    expect(t.bus.boardEvents[2]!.event).toMatchObject({ type: 'label.deleted', labelId: label.id });
  });

  it('rejects colors outside the fixed palette and blank names with 422', async () => {
    const { u, projectId } = await setup();
    const url = `/api/orgs/${u.orgId}/projects/${projectId}/labels`;
    const bad = await call('POST', url, u.cookie, { name: 'X', color: '#123456' });
    expect(bad.statusCode).toBe(422);
    const blank = await call('POST', url, u.cookie, { name: ' ', color: '#ef4444' });
    expect(blank.statusCode).toBe(422);
  });

  it('deleting a label removes it from cards and emits label.deleted', async () => {
    const { u, projectId } = await setup();
    const board = (
      await call('GET', `/api/orgs/${u.orgId}/projects/${projectId}/board`, u.cookie)
    ).json<{ columns: Array<{ id: string }> }>();
    const label = (
      await call('POST', `/api/orgs/${u.orgId}/projects/${projectId}/labels`, u.cookie, {
        name: 'Bug',
        color: '#ef4444',
      })
    ).json<{ id: string }>();
    const card = (
      await call('POST', `/api/orgs/${u.orgId}/columns/${board.columns[0]!.id}/cards`, u.cookie, {
        title: 'C',
        labelIds: [label.id],
      })
    ).json<{ labelIds: string[] }>();
    expect(card.labelIds).toEqual([label.id]);
    t.bus.boardEvents.length = 0;
    await call('DELETE', `/api/orgs/${u.orgId}/labels/${label.id}`, u.cookie);
    const after = (
      await call('GET', `/api/orgs/${u.orgId}/projects/${projectId}/board`, u.cookie)
    ).json<{ cards: Array<{ labelIds: string[] }>; labels: unknown[] }>();
    expect(after.cards[0]!.labelIds).toEqual([]);
    expect(after.labels).toEqual([]);
    expect(t.bus.boardEvents.map((e) => e.event.type)).toEqual(['label.deleted']);
  });

  it('another org gets 404 on label routes', async () => {
    const { u, projectId } = await setup();
    const other = await signUp(t.app, { email: 'b@x.com', orgName: 'Other' });
    const label = (
      await call('POST', `/api/orgs/${u.orgId}/projects/${projectId}/labels`, u.cookie, {
        name: 'Bug',
        color: '#ef4444',
      })
    ).json<{ id: string }>();
    const patchForeign = await call(
      'PATCH',
      `/api/orgs/${u.orgId}/labels/${label.id}`,
      other.cookie,
      {
        name: 'Z',
      },
    );
    expect(patchForeign.statusCode).toBe(404);
    const patchOwnOrg = await call(
      'PATCH',
      `/api/orgs/${other.orgId}/labels/${label.id}`,
      other.cookie,
      {
        name: 'Z',
      },
    );
    expect(patchOwnOrg.statusCode).toBe(404);
    const del = await call('DELETE', `/api/orgs/${other.orgId}/labels/${label.id}`, other.cookie);
    expect(del.statusCode).toBe(404);
    const create = await call(
      'POST',
      `/api/orgs/${other.orgId}/projects/${projectId}/labels`,
      other.cookie,
      { name: 'Z', color: '#ef4444' },
    );
    expect(create.statusCode).toBe(404);
  });
});
