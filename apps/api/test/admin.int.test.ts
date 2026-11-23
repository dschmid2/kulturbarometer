import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Sql } from '../src/db/client.js';
import { createTestDb, TEST_DATABASE_URL, truncateAll } from './db.js';

const AUTH = { Authorization: 'Bearer admin-token' };

describe.skipIf(!TEST_DATABASE_URL)('Admin-API mit Datenbank', () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    sql = await createTestDb();
    app = createApp({
      sql: () => sql,
      verifyAdmin: async (token) =>
        token === 'admin-token' ? { userId: 'u1', email: 'a@example.org' } : null,
    });
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await truncateAll(sql);
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
    it('liefert die Identität mit gültigem Token', async () => {
      const res = await api().get('/api/admin/me');
      expect(res.body).toEqual({ userId: 'u1', email: 'a@example.org' });
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
});
