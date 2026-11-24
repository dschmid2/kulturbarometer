import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Sql } from '../src/db/client.js';
import { createTestDb, TEST_DATABASE_URL, truncateAll } from './db.js';

// Benutzer der Tests (IDs fest, damit Mitgliedschaften zugeordnet werden können)
const USERS = {
  owner: { userId: '00000000-0000-4000-8000-00000000a001', email: 'owner@example.org' },
  werte: { userId: '00000000-0000-4000-8000-00000000a002', email: 'werte@example.org' },
  kampagnen: { userId: '00000000-0000-4000-8000-00000000a003', email: 'kampagnen@example.org' },
  admin: { userId: '00000000-0000-4000-8000-00000000a004', email: 'admin@example.org' },
  outsider: { userId: '00000000-0000-4000-8000-00000000a005', email: 'outsider@example.org' },
  platform: { userId: '00000000-0000-4000-8000-00000000a006', email: 'platform@example.org' },
} as const;
type UserKey = keyof typeof USERS;
const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const AUTH = { Authorization: 'Bearer owner', 'X-Organization-Id': ORG_A };

describe.skipIf(!TEST_DATABASE_URL)('Admin-API mit Datenbank', () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    sql = await createTestDb();
    app = createApp({
      sql: () => sql,
      verifyToken: async (token) => {
        const user = USERS[token as UserKey];
        return user ? { ...user, platformAdmin: token === 'platform' } : null;
      },
      userDirectory: {
        async findByEmail(email) {
          const user = Object.values(USERS).find((u) => u.email === email.toLowerCase());
          return user ? { id: user.userId, email: user.email } : null;
        },
        async invite(email) {
          return email.endsWith('@invite.test')
            ? { id: '00000000-0000-4000-8000-00000000a0ff', email }
            : null;
        },
      },
    });
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await truncateAll(sql);
    await sql`insert into organization (id, name) values (${ORG_A}, 'Alpha AG'), (${ORG_B}, 'Beta AG')`;
    const members: [string, UserKey, string[]][] = [
      [ORG_A, 'owner', ['ADMIN', 'WERTE', 'KAMPAGNEN']],
      [ORG_A, 'werte', ['WERTE']],
      [ORG_A, 'kampagnen', ['KAMPAGNEN']],
      [ORG_A, 'admin', ['ADMIN']],
      [ORG_B, 'owner', ['WERTE']],
    ];
    for (const [org, key, roles] of members) {
      await sql`insert into organization_member (organization_id, user_id, email, roles)
                values (${org}, ${USERS[key].userId}, ${USERS[key].email}, ${roles})`;
    }
  });

  const api = () => ({
    get: (url: string) => request(app).get(url).set(AUTH),
    post: (url: string, body?: object) =>
      request(app)
        .post(url)
        .set(AUTH)
        .send(body ?? {}),
    put: (url: string, body: object) => request(app).put(url).set(AUTH).send(body),
    del: (url: string) => request(app).delete(url).set(AUTH),
  });

  /** Anfrage als bestimmter Benutzer in einer bestimmten Unternehmung. */
  const as = (user: UserKey, org: string | null = ORG_A) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${user}` };
    if (org) headers['X-Organization-Id'] = org;
    return {
      get: (url: string) => request(app).get(url).set(headers),
      post: (url: string, body?: object) =>
        request(app)
          .post(url)
          .set(headers)
          .send(body ?? {}),
      put: (url: string, body: object) => request(app).put(url).set(headers).send(body),
      del: (url: string) => request(app).delete(url).set(headers),
    };
  };

  async function value(name: string) {
    const res = await api().post('/api/admin/values', { name, description: '' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function item(valueId: string, overrides: object = {}) {
    const res = await api().post('/api/admin/items', {
      text: 'Ich halte zugesagte Termine ein',
      itemType: 'FRAGE',
      perspective: 'SELBST',
      assignments: [{ valueId, weight: 80 }],
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; familyId: string };
  }

  /** Simuliert die Aktivierung einer Kampagne: Snapshot und Verwendet-Kennzeichen. */
  async function markUsed(itemId: string) {
    await sql`update item set used_at = now() where id = ${itemId}`;
  }

  describe('Anmeldung (Anforderung 1.4)', () => {
    it('weist Admin-Routen ohne Token ab', async () => {
      const res = await request(app).get('/api/admin/values');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });
    it('weist ungültige Tokens ab', async () => {
      const res = await request(app).get('/api/admin/values').set('Authorization', 'Bearer falsch');
      expect(res.status).toBe(401);
    });
    it('liefert die Identität mit Unternehmungen und Rollen', async () => {
      const res = await api().get('/api/admin/me');
      expect(res.body).toEqual({
        userId: USERS.owner.userId,
        email: USERS.owner.email,
        platformAdmin: false,
        organizations: [
          { id: ORG_A, name: 'Alpha AG', roles: ['ADMIN', 'WERTE', 'KAMPAGNEN'] },
          { id: ORG_B, name: 'Beta AG', roles: ['WERTE'] },
        ],
      });
    });
  });

  describe('Unternehmungen und Rollen (Anforderung 12)', () => {
    it('verlangt eine Unternehmung und eine Mitgliedschaft', async () => {
      expect((await as('owner', null).get('/api/admin/values')).body.code).toBe(
        'ORGANIZATION_REQUIRED',
      );
      expect((await as('outsider').get('/api/admin/values')).status).toBe(403);
    });

    it('trennt die Daten der Unternehmungen', async () => {
      await value('Vertrauen');
      expect((await as('owner', ORG_B).get('/api/admin/values')).body).toEqual([]);
      // Gleicher Name in anderer Unternehmung ist erlaubt
      expect(
        (await as('owner', ORG_B).post('/api/admin/values', { name: 'Vertrauen', description: '' }))
          .status,
      ).toBe(201);
      const idA = (await api().get('/api/admin/values')).body[0].id;
      expect(
        (await as('owner', ORG_B).put(`/api/admin/values/${idA}`, { name: 'X', description: '' }))
          .status,
      ).toBe(404);
      // Frage in B mit Wert aus A ist nicht möglich
      const res = await as('owner', ORG_B).post('/api/admin/items', {
        text: 'Fremde Zuordnung',
        itemType: 'FRAGE',
        perspective: 'SELBST',
        assignments: [{ valueId: idA, weight: 50 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNKNOWN_VALUE');
    });

    it('setzt die Rollen durch', async () => {
      const v = await value('Vertrauen');
      // Werte-Administration darf Werte ändern, aber keine Benutzer verwalten
      expect(
        (await as('werte').post('/api/admin/values', { name: 'Mut', description: '' })).status,
      ).toBe(201);
      expect((await as('werte').get('/api/admin/members')).status).toBe(403);
      // Kampagnen-Administration darf Werte und Fragen lesen, aber nicht ändern
      expect((await as('kampagnen').get('/api/admin/values')).status).toBe(200);
      expect((await as('kampagnen').get('/api/admin/items')).status).toBe(200);
      const denied = await as('kampagnen').put(`/api/admin/values/${v}`, {
        name: 'X',
        description: '',
      });
      expect(denied.status).toBe(403);
      expect(denied.body.message).toContain('Werte-Administration');
      // Benutzer-Administration allein sieht keine Werte
      expect((await as('admin').get('/api/admin/values')).status).toBe(403);
      expect((await as('admin').get('/api/admin/members')).status).toBe(200);
    });

    it('verwaltet Benutzer der Unternehmung', async () => {
      const add = await as('admin').post('/api/admin/members', {
        email: 'Outsider@example.org',
        roles: ['WERTE'],
      });
      expect(add.status).toBe(201);
      expect(add.body).toMatchObject({
        userId: USERS.outsider.userId,
        roles: ['WERTE'],
        invited: false,
      });
      expect((await as('outsider').get('/api/admin/values')).status).toBe(200);

      const dup = await as('admin').post('/api/admin/members', {
        email: 'outsider@example.org',
        roles: ['WERTE'],
      });
      expect(dup.body.code).toBe('ALREADY_MEMBER');
      const unknown = await as('admin').post('/api/admin/members', {
        email: 'neu@example.org',
        roles: ['WERTE'],
      });
      expect(unknown.body.code).toBe('USER_NOT_FOUND');
      const invited = await as('admin').post('/api/admin/members', {
        email: 'neu@invite.test',
        roles: ['KAMPAGNEN'],
      });
      expect(invited.body).toMatchObject({ invited: true, roles: ['KAMPAGNEN'] });

      const upd = await as('admin').put(`/api/admin/members/${USERS.outsider.userId}`, {
        roles: ['WERTE', 'KAMPAGNEN'],
      });
      expect(upd.body.roles).toEqual(['WERTE', 'KAMPAGNEN']);
      expect((await as('admin').del(`/api/admin/members/${USERS.outsider.userId}`)).status).toBe(
        204,
      );
      expect((await as('outsider').get('/api/admin/values')).status).toBe(403);
    });

    it('lässt die letzte Benutzer-Administration nicht entfernen', async () => {
      await as('admin').put(`/api/admin/members/${USERS.owner.userId}`, { roles: ['WERTE'] });
      const res = await as('admin').put(`/api/admin/members/${USERS.admin.userId}`, {
        roles: ['WERTE'],
      });
      expect(res.body.code).toBe('LAST_ADMIN');
      expect((await as('admin').del(`/api/admin/members/${USERS.admin.userId}`)).body.code).toBe(
        'LAST_ADMIN',
      );
    });

    it('erlaubt Unternehmungen nur Plattform-Administratoren', async () => {
      expect((await as('owner', null).get('/api/admin/organizations')).status).toBe(403);
      const created = await as('platform', null).post('/api/admin/organizations', {
        name: 'Gamma GmbH',
      });
      expect(created.status).toBe(201);
      expect(
        (await as('platform', null).post('/api/admin/organizations', { name: 'Gamma GmbH' })).body
          .code,
      ).toBe('DUPLICATE_NAME');
      const renamed = await as('platform', null).put(
        `/api/admin/organizations/${created.body.id}`,
        { name: 'Gamma AG' },
      );
      expect(renamed.body.name).toBe('Gamma AG');
      // Plattform-Admins haben in jeder Unternehmung alle Rollen, auch ohne Mitgliedschaft
      const me = await as('platform', null).get('/api/admin/me');
      expect(me.body.platformAdmin).toBe(true);
      expect(me.body.organizations).toHaveLength(3);
      expect((await as('platform', created.body.id).get('/api/admin/values')).status).toBe(200);
    });
  });

  describe('Unternehmenswerte (Anforderung 2)', () => {
    it('legt Werte an, listet sie und verwaltet Fokussätze', async () => {
      const id = await value('Vertrauen');
      const added = await api().post(`/api/admin/values/${id}/focus-sentences`, {
        text: 'Wir halten Zusagen ein.',
      });
      expect(added.status).toBe(201);
      expect(added.body.focusSentences).toHaveLength(1);
      const sentenceId = added.body.focusSentences[0].id;
      const edited = await api().put(`/api/admin/focus-sentences/${sentenceId}`, {
        text: 'Wir halten Termine ein.',
      });
      expect(edited.body.focusSentences[0].text).toBe('Wir halten Termine ein.');
      const list = await api().get('/api/admin/values');
      expect(list.body.map((v: { name: string }) => v.name)).toEqual(['Vertrauen']);
      const removed = await api().del(`/api/admin/focus-sentences/${sentenceId}`);
      expect(removed.body.focusSentences).toHaveLength(0);
    });

    it('lehnt leere und doppelte Namen ab (2.2, 2.3)', async () => {
      await value('Vertrauen');
      const empty = await api().post('/api/admin/values', { name: '  ', description: '' });
      expect(empty.status).toBe(422);
      expect(empty.body.fieldErrors.name).toBeDefined();
      const dup = await api().post('/api/admin/values', { name: 'Vertrauen', description: '' });
      expect(dup.status).toBe(409);
      expect(dup.body.fieldErrors.name[0]).toContain('bereits vergeben');
    });

    it('lehnt zu lange Fokussätze ab (2.5)', async () => {
      const id = await value('Vertrauen');
      const res = await api().post(`/api/admin/values/${id}/focus-sentences`, {
        text: 'x'.repeat(501),
      });
      expect(res.status).toBe(422);
    });

    it('löscht nicht referenzierte Werte und setzt betroffene Items zurück (2.8, 2.13)', async () => {
      const keep = await value('Vertrauen');
      const gone = await value('Mut');
      const only = await item(gone);
      await api().post(`/api/admin/items/${only.id}/approve`);
      const shared = await item(keep, {
        assignments: [
          { valueId: keep, weight: 50 },
          { valueId: gone, weight: 50 },
        ],
      });
      expect((await api().del(`/api/admin/values/${gone}`)).status).toBe(204);
      expect((await api().get(`/api/admin/items/${only.id}`)).body).toMatchObject({
        status: 'ZUR_PRUEFUNG',
        assignments: [],
      });
      expect((await api().get(`/api/admin/items/${shared.id}`)).body.assignments).toHaveLength(1);
    });

    it('lehnt das Löschen ab, wenn eine verwendete Version den Wert referenziert (2.10)', async () => {
      const id = await value('Vertrauen');
      const i = await item(id);
      await markUsed(i.id);
      const res = await api().del(`/api/admin/values/${id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VALUE_REFERENCED_BY_USED_ITEM');
    });

    it('erlaubt das Bearbeiten trotz Verwendung (2.7)', async () => {
      const id = await value('Vertrauen');
      await markUsed((await item(id)).id);
      const res = await api().put(`/api/admin/values/${id}`, {
        name: 'Verlässlichkeit',
        description: 'neu',
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Verlässlichkeit');
    });
  });

  describe('Items (Anforderung 5)', () => {
    it('legt Items im Status „zur Prüfung" an und gibt sie frei (5.1, 5.13)', async () => {
      const v = await value('Vertrauen');
      const i = await item(v);
      expect((await api().get(`/api/admin/items/${i.id}`)).body).toMatchObject({
        status: 'ZUR_PRUEFUNG',
        versionNumber: 1,
        used: false,
      });
      const approved = await api().post(`/api/admin/items/${i.id}/approve`);
      expect(approved.body.status).toBe('FREIGEGEBEN');
    });

    it('lehnt Items ohne Zuordnung > 0 % ab (5.8)', async () => {
      const v = await value('Vertrauen');
      const res = await api().post('/api/admin/items', {
        text: 'Text',
        itemType: 'FRAGE',
        perspective: 'TEAM',
        assignments: [{ valueId: v, weight: 0 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors.assignments[0]).toContain('größer als 0 %');
    });

    it('setzt ein bearbeitetes, nicht verwendetes freigegebenes Item auf „zur Prüfung" (5.15)', async () => {
      const v = await value('Vertrauen');
      const i = await item(v);
      await api().post(`/api/admin/items/${i.id}/approve`);
      const res = await api().put(`/api/admin/items/${i.id}`, {
        text: 'In meinem Team werden Termine eingehalten',
        itemType: 'FRAGE',
        perspective: 'TEAM',
        assignments: [{ valueId: v, weight: 100 }],
      });
      expect(res.body).toMatchObject({
        id: i.id,
        status: 'ZUR_PRUEFUNG',
        perspective: 'TEAM',
        newVersion: false,
      });
    });

    it('legt bei verwendeten Versionen eine neue Version an und lässt den Vorgänger unverändert (5.21–5.23)', async () => {
      const v = await value('Vertrauen');
      const i = await item(v);
      await api().post(`/api/admin/items/${i.id}/approve`);
      await markUsed(i.id);
      const res = await api().put(`/api/admin/items/${i.id}`, {
        text: 'Ich halte Termine verlässlich ein',
        itemType: 'FRAGE',
        perspective: 'SELBST',
        assignments: [{ valueId: v, weight: 90 }],
      });
      expect(res.body).toMatchObject({
        versionNumber: 2,
        predecessorId: i.id,
        status: 'ZUR_PRUEFUNG',
        newVersion: true,
        used: false,
      });
      const old = await api().get(`/api/admin/items/${i.id}`);
      expect(old.body).toMatchObject({
        text: 'Ich halte zugesagte Termine ein',
        status: 'FREIGEGEBEN',
        used: true,
      });
      expect(old.body.assignments[0].weight).toBe(80);
      const versions = await api().get(`/api/admin/item-families/${i.familyId}/versions`);
      expect(
        versions.body.map((x: { versionNumber: number; used: boolean }) => [
          x.versionNumber,
          x.used,
        ]),
      ).toEqual([
        [1, true],
        [2, false],
      ]);
    });

    it('vergibt bei parallelen neuen Versionen eindeutige Versionsnummern', async () => {
      const v = await value('Vertrauen');
      const i = await item(v);
      await markUsed(i.id);
      const body = {
        text: 'Neu',
        itemType: 'FRAGE',
        perspective: 'SELBST',
        assignments: [{ valueId: v, weight: 50 }],
      };
      const results = await Promise.all(
        [1, 2, 3].map(() => api().put(`/api/admin/items/${i.id}`, body)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.map((r) => r.body.versionNumber).sort()).toEqual([2, 3, 4]);
    });

    it('verhindert das Löschen verwendeter Versionen und löscht nicht verwendete samt leerer Familie (5.26, 5.27)', async () => {
      const v = await value('Vertrauen');
      const used = await item(v);
      await markUsed(used.id);
      expect((await api().del(`/api/admin/items/${used.id}`)).body.code).toBe(
        'USED_ITEM_NOT_DELETABLE',
      );
      const unused = await item(v);
      expect((await api().del(`/api/admin/items/${unused.id}`)).status).toBe(204);
      const [family] = await sql`select 1 from item_family where id = ${unused.familyId}`;
      expect(family).toBeUndefined();
    });

    it('deaktiviert freigegebene Items und erlaubt die erneute Freigabe auch bei Verwendung (5.16, 5.25)', async () => {
      const v = await value('Vertrauen');
      const i = await item(v);
      await api().post(`/api/admin/items/${i.id}/approve`);
      await markUsed(i.id);
      expect((await api().post(`/api/admin/items/${i.id}/deactivate`)).body.status).toBe(
        'DEAKTIVIERT',
      );
      const again = await api().post(`/api/admin/items/${i.id}/approve`);
      expect(again.body).toMatchObject({ status: 'FREIGEGEBEN', versionNumber: 1 });
    });

    it('filtert Items nach Wert mit Gewichtung > 0 % (5.28)', async () => {
      const a = await value('Vertrauen');
      const b = await value('Mut');
      await item(a);
      await item(a, {
        assignments: [
          { valueId: a, weight: 50 },
          { valueId: b, weight: 0 },
        ],
      });
      await item(b);
      expect((await api().get(`/api/admin/items?valueId=${a}`)).body).toHaveLength(2);
      expect((await api().get(`/api/admin/items?valueId=${b}`)).body).toHaveLength(1);
    });

    it('gibt mehrere Fragen gesammelt frei und meldet übersprungene mit Grund (5.13, 5.14)', async () => {
      const v = await value('Vertrauen');
      const a = await item(v);
      const b = await item(v, { perspective: 'TEAM' });
      const already = await item(v, { perspective: 'FUEHRUNG' });
      await api().post(`/api/admin/items/${already.id}/approve`);
      // Ungültig machen: einzige Zuordnung auf 0 % setzen (direkt in der Datenbank)
      const invalid = await item(v, { text: 'Ungültige Frage' });
      await sql`update value_assignment set weight = 0 where item_id = ${invalid.id}`;
      const unknown = '00000000-0000-4000-8000-000000000999';

      const res = await api().post('/api/admin/items/bulk-approve', {
        ids: [a.id, b.id, already.id, invalid.id, unknown, a.id],
      });
      expect(res.status).toBe(200);
      expect(res.body.approved.sort()).toEqual([a.id, b.id].sort());
      const reasons = Object.fromEntries(
        res.body.skipped.map((s: { id: string; reason: string }) => [s.id, s.reason]),
      );
      expect(reasons[already.id]).toContain('bereits freigegeben');
      expect(reasons[invalid.id]).toContain('größer als 0 %');
      expect(reasons[unknown]).toContain('nicht gefunden');
      const statuses = await sql<{ id: string; status: string }[]>`
        select id, status from item where id = any(${[a.id, b.id, invalid.id]}::uuid[])`;
      expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({
        [a.id]: 'FREIGEGEBEN',
        [b.id]: 'FREIGEGEBEN',
        [invalid.id]: 'ZUR_PRUEFUNG',
      });
    });

    it('lehnt eine leere Auswahl ab', async () => {
      const res = await api().post('/api/admin/items/bulk-approve', { ids: [] });
      expect(res.status).toBe(422);
    });

    it('liefert 404 für unbekannte oder ungültige IDs', async () => {
      expect((await api().get('/api/admin/items/keine-uuid')).status).toBe(404);
      expect(
        (await api().get('/api/admin/items/00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
    });
  });

  describe('Kampagnen (Anforderung 6)', () => {
    async function approvedItem(valueId: string, perspective = 'SELBST') {
      const i = await item(valueId, { perspective });
      await api().post(`/api/admin/items/${i.id}/approve`);
      return i.id;
    }
    async function campaign() {
      const res = await api().post('/api/admin/campaigns', {
        title: 'Herbst 2026',
        startDate: '2026-12-01',
        endDate: '2026-12-20',
      });
      expect(res.status).toBe(201);
      return res.body as { id: string; status: string; anonymityThreshold: number };
    }
    const settings = (n: number | null, threshold = 5) => ({
      title: 'Herbst 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-20',
      itemsPerParticipant: n,
      anonymityThreshold: threshold,
    });

    it('legt Kampagnen als Entwurf mit Vorgabe-Schwelle 5 an (6.1, 6.28)', async () => {
      const c = await campaign();
      expect(c).toMatchObject({ status: 'ENTWURF', anonymityThreshold: 5 });
      const bad = await api().post('/api/admin/campaigns', {
        title: 'X',
        startDate: '2026-12-20',
        endDate: '2026-12-01',
      });
      expect(bad.status).toBe(422);
      expect(bad.body.fieldErrors.endDate).toBeDefined();
    });

    it('nimmt nur freigegebene Fragen in den Pool und leitet die Werte ab (6.4, 6.5)', async () => {
      const v = await value('Vertrauen');
      const ok = await approvedItem(v);
      const draft = (await item(v)).id;
      const c = await campaign();
      const rejected = await api().put(`/api/admin/campaigns/${c.id}/pool`, {
        itemIds: [ok, draft],
      });
      expect(rejected.body.code).toBe('ITEM_NOT_APPROVED');
      expect((await api().get(`/api/admin/campaigns/${c.id}`)).body.items).toHaveLength(0);
      const res = await api().put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: [ok] });
      expect(res.body.poolSize).toBe(1);
      expect(res.body.values).toEqual([{ id: v, name: 'Vertrauen' }]);
    });

    it('aktiviert nur mit gültigen Einstellungen und friert den Snapshot ein (6.9–6.13)', async () => {
      const v = await value('Vertrauen');
      const a = await approvedItem(v);
      const b = await approvedItem(v, 'TEAM');
      const c = await campaign();
      expect((await api().post(`/api/admin/campaigns/${c.id}/activate`)).body.code).toBe(
        'EMPTY_POOL',
      );
      await api().put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: [a, b] });
      expect((await api().post(`/api/admin/campaigns/${c.id}/activate`)).body.code).toBe(
        'INVALID_ITEMS_PER_PARTICIPANT',
      );
      await api().put(`/api/admin/campaigns/${c.id}`, settings(3));
      expect((await api().post(`/api/admin/campaigns/${c.id}/activate`)).body.code).toBe(
        'INVALID_ITEMS_PER_PARTICIPANT',
      );
      await api().put(`/api/admin/campaigns/${c.id}`, settings(2, 7));
      // Eine Pool-Frage wird vor der Aktivierung bearbeitet und ist damit nicht mehr freigegeben
      await api().put(`/api/admin/items/${b}`, {
        text: 'Geändert',
        itemType: 'FRAGE',
        perspective: 'TEAM',
        assignments: [{ valueId: v, weight: 100 }],
      });
      expect((await api().get(`/api/admin/campaigns/${c.id}`)).body.poolSize).toBe(1);
      await api().put(`/api/admin/campaigns/${c.id}`, settings(1, 7));

      const act = await api().post(`/api/admin/campaigns/${c.id}/activate`);
      expect(act.status).toBe(200);
      expect(act.body).toMatchObject({ status: 'AKTIV', poolSize: 1, anonymityThreshold: 7 });
      expect(act.body.items[0]).toMatchObject({ itemVersionId: a, deactivatedAt: null });
      expect(act.body.items[0].assignments).toEqual([
        { valueId: v, valueName: 'Vertrauen', weight: 80 },
      ]);
      expect((await api().get(`/api/admin/items/${a}`)).body.used).toBe(true);

      // Danach unveränderlich (6.14, 6.30)
      expect((await api().put(`/api/admin/campaigns/${c.id}`, settings(1, 9))).body.code).toBe(
        'SNAPSHOT_IMMUTABLE',
      );
      expect(
        (await api().put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: [] })).body.code,
      ).toBe('SNAPSHOT_IMMUTABLE');
      // Änderungen an der Quelle lassen den Snapshot unberührt (5.31)
      await api().put(`/api/admin/values/${v}`, { name: 'Verlässlichkeit', description: '' });
      const after = await api().get(`/api/admin/campaigns/${c.id}`);
      expect(after.body.items[0].assignments[0].valueName).toBe('Vertrauen');
    });

    it('schliesst nur aktive Kampagnen ab und löscht nur Entwürfe (6.25, 6.26)', async () => {
      const v = await value('Vertrauen');
      const a = await approvedItem(v);
      const c = await campaign();
      expect((await api().post(`/api/admin/campaigns/${c.id}/close`)).body.code).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      await api().put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: [a] });
      await api().put(`/api/admin/campaigns/${c.id}`, settings(1));
      await api().post(`/api/admin/campaigns/${c.id}/activate`);
      expect((await api().del(`/api/admin/campaigns/${c.id}`)).body.code).toBe(
        'SNAPSHOT_IMMUTABLE',
      );
      expect((await api().post(`/api/admin/campaigns/${c.id}/close`)).body.status).toBe(
        'ABGESCHLOSSEN',
      );
      const draft = await campaign();
      expect((await api().del(`/api/admin/campaigns/${draft.id}`)).status).toBe(204);
    });

    it('verlangt die Rolle Kampagnen-Administration und trennt Unternehmungen', async () => {
      const c = await campaign();
      expect((await as('werte').get('/api/admin/campaigns')).status).toBe(403);
      expect((await as('kampagnen').get('/api/admin/campaigns')).body).toHaveLength(1);
      expect((await as('owner', ORG_B).get(`/api/admin/campaigns/${c.id}`)).status).toBe(403);
    });
  });
  describe('Auswertung (Anforderung 9 und 10)', () => {
    async function activeCampaign(threshold = 3) {
      const v = await value('Vertrauen');
      const ids: string[] = [];
      for (const perspective of ['SELBST', 'TEAM']) {
        const i = await item(v, { perspective });
        await api().post(`/api/admin/items/${i.id}/approve`);
        ids.push(i.id);
      }
      const c = (
        await api().post('/api/admin/campaigns', {
          title: 'Herbst 2026',
          startDate: '2026-12-01',
          endDate: '2026-12-20',
        })
      ).body as { id: string };
      await api().put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: ids });
      await api().put(`/api/admin/campaigns/${c.id}`, {
        title: 'Herbst 2026',
        startDate: '2026-12-01',
        endDate: '2026-12-20',
        itemsPerParticipant: 2,
        anonymityThreshold: threshold,
      });
      const act = await api().post(`/api/admin/campaigns/${c.id}/activate`);
      const items = act.body.items as { id: string; perspective: string }[];
      const sid = (p: string) => items.find((i) => i.perspective === p)!.id;
      let seq = 0;
      /** Legt eine Abgabe direkt in der Datenbank an (die öffentliche Umfrage folgt später). */
      const submit = async (ratings: [string, number, string?][]) => {
        seq++;
        const [p] = await sql<{ id: string }[]>`
          insert into participation (campaign_id, submission_seq, drawn_snapshot_item_ids)
          values (${c.id}, ${seq}, ${ratings.map((r) => sid(r[0]))}) returning id`;
        for (const [persp, rating, comment] of ratings) {
          await sql`insert into answer_item (participation_id, snapshot_item_id, rating, comment)
                    values (${p!.id}, ${sid(persp)}, ${rating}, ${comment ?? null})`;
        }
      };
      return { id: c.id, valueId: v, submit };
    }
    const evaluation = async (id: string) =>
      (await api().get(`/api/admin/campaigns/${id}/evaluation`)).body.evaluation;

    it('zeigt Hinweise für Entwurf, keine Antworten und unter der Schwelle (10.6–10.8)', async () => {
      const draft = (
        await api().post('/api/admin/campaigns', {
          title: 'Entwurf',
          startDate: '2026-12-01',
          endDate: '2026-12-20',
        })
      ).body;
      expect(await evaluation(draft.id)).toEqual({ state: 'ENTWURF' });
      const c = await activeCampaign();
      expect(await evaluation(c.id)).toEqual({ state: 'KEINE_ANTWORTEN', provisional: true });
      await c.submit([['SELBST', 4, 'Geheim']]);
      await c.submit([['SELBST', 5]]);
      const under = await evaluation(c.id);
      expect(under).toEqual({
        state: 'UNTER_SCHWELLE',
        provisional: true,
        totalParticipations: 2,
        threshold: 3,
      });
      expect(JSON.stringify(under)).not.toContain('Geheim');
    });

    it('wertet stufenweise aus und unterdrückt Perspektiven unter der Schwelle (10.12–10.14)', async () => {
      const c = await activeCampaign();
      await c.submit([
        ['SELBST', 4],
        ['TEAM', 2, 'Zu wenig Austausch'],
      ]);
      await c.submit([
        ['SELBST', 3],
        ['TEAM', 3],
      ]);
      await c.submit([['SELBST', 5]]);
      await c.submit([
        ['SELBST', 1],
        ['TEAM', 1],
      ]);
      const interim = await evaluation(c.id);
      expect(interim).toMatchObject({
        state: 'OK',
        provisional: true,
        totalParticipations: 4,
        includedParticipations: 3,
      });
      const v = interim.values[0];
      expect(v.perspectives.SELBST).toMatchObject({ shown: true, istScore: 4, contributors: 3 });
      expect(v.perspectives.SELBST.distribution.classCounts).toEqual([0, 0, 1, 1, 1]);
      expect(v.perspectives.TEAM).toEqual({ shown: false, reason: 'ZU_WENIGE_ANTWORTEN' });
      expect(v.perspectives.FUEHRUNG).toEqual({ shown: false, reason: 'KEINE_DATEN' });
      expect(v.gaps.selbstTeam).toBeNull();
      expect(v.comments).toEqual({ shown: true, items: ['Zu wenig Austausch'] });

      await api().post(`/api/admin/campaigns/${c.id}/close`);
      const final = await evaluation(c.id);
      expect(final).toMatchObject({ provisional: false, includedParticipations: 4 });
      expect(final.values[0].perspectives.SELBST.istScore).toBe(3.25);
      expect(final.values[0].perspectives.TEAM).toMatchObject({ shown: true, istScore: 2 });
      expect(final.values[0].gaps.selbstTeam).toBe(1.25);
      expect(final.deactivatedItems).toEqual([]);
    });

    it('liefert den Verlauf über abgeschlossene Kampagnen (10.4, 10.15, 10.20)', async () => {
      const c = await activeCampaign();
      for (const r of [3, 4, 5])
        await c.submit([
          ['SELBST', r],
          ['TEAM', r - 1],
        ]);
      expect((await api().get('/api/admin/evaluation/trends')).body.campaigns).toEqual([]);
      await api().post(`/api/admin/campaigns/${c.id}/close`);
      const trends = (await api().get('/api/admin/evaluation/trends')).body;
      expect(trends.campaigns).toHaveLength(1);
      expect(trends.values[0]).toMatchObject({ valueId: c.valueId, name: 'Vertrauen' });
      expect(trends.values[0].points[0].SELBST).toEqual({
        istScore: 4,
        stdDev: 0.82,
        direction: null,
      });
      expect(trends.values[0].points[0].FUEHRUNG).toBeNull();
    });

    it('verlangt die Rolle Kampagnen-Administration und trennt Unternehmungen', async () => {
      const c = await activeCampaign();
      expect((await as('werte').get(`/api/admin/campaigns/${c.id}/evaluation`)).status).toBe(403);
      expect((await as('werte').get('/api/admin/evaluation/trends')).status).toBe(403);
      expect((await as('owner', ORG_B).get(`/api/admin/campaigns/${c.id}/evaluation`)).status).toBe(
        403,
      );
      expect((await as('kampagnen').get(`/api/admin/campaigns/${c.id}/evaluation`)).status).toBe(
        200,
      );
    });
  });
});
