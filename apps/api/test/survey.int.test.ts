import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Sql } from '../src/db/client.js';
import { participantHash } from '../src/modules/survey.js';
import { createTestDb, TEST_DATABASE_URL, truncateAll } from './db.js';

const ADMIN = { userId: '00000000-0000-4000-8000-00000000b001', email: 'admin@example.org' };
const ORG = '00000000-0000-4000-8000-0000000000cc';
const HDR = { Authorization: 'Bearer admin', 'X-Organization-Id': ORG };
const CODE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CODE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe.skipIf(!TEST_DATABASE_URL)('Umfrage-Link und Teilnahme (Anforderung 7 und 8)', () => {
  let sql: Sql;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    sql = await createTestDb();
    app = createApp({
      sql: () => sql,
      auth: {
        name: 'test',
        verifyToken: async (t) => (t === 'admin' ? ADMIN : null),
        directory: { findByEmail: async () => null, invite: async () => null },
      },
    });
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await truncateAll(sql);
    await sql`insert into organization (id, name) values (${ORG}, 'Gamma AG')`;
    await sql`insert into organization_member (organization_id, user_id, email, roles)
              values (${ORG}, ${ADMIN.userId}, ${ADMIN.email}, ${['ADMIN', 'WERTE', 'KAMPAGNEN']})`;
  });

  const admin = {
    get: (url: string) => request(app).get(url).set(HDR),
    post: (url: string, body: object = {}) => request(app).post(url).set(HDR).send(body),
    put: (url: string, body: object) => request(app).put(url).set(HDR).send(body),
  };
  const open = (token: string, code = CODE_A) =>
    request(app).post(`/api/public/survey/${token}/open`).send({ code });
  const submit = (token: string, answers: object[], code = CODE_A) =>
    request(app).post(`/api/public/survey/${token}/submit`).send({ code, answers });

  /** Aktive Kampagne mit 5 Fragen im Pool, 3 je Person, Schwelle 3. */
  async function activeCampaign() {
    const v = (await admin.post('/api/admin/values', { name: 'Vertrauen', description: '' })).body
      .id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const it = await admin.post('/api/admin/items', {
        text: `Frage ${i + 1}`,
        itemType: 'FRAGE',
        perspective: (['SELBST', 'TEAM', 'FUEHRUNG'] as const)[i % 3],
        assignments: [{ valueId: v, weight: 100 }],
      });
      await admin.post(`/api/admin/items/${it.body.id}/approve`);
      ids.push(it.body.id);
    }
    const settings = { title: 'Frühling', startDate: '2026-12-01', endDate: '2026-12-20' };
    const c = (await admin.post('/api/admin/campaigns', settings)).body;
    await admin.put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: ids });
    await admin.put(`/api/admin/campaigns/${c.id}`, {
      ...settings,
      itemsPerParticipant: 3,
      anonymityThreshold: 3,
    });
    await admin.post(`/api/admin/campaigns/${c.id}/activate`);
    return c.id as string;
  }

  it('erzeugt nur für aktive Kampagnen einen Link und ersetzt ihn (7.2, 7.15, 7.16)', async () => {
    const draft = (
      await admin.post('/api/admin/campaigns', {
        title: 'Entwurf',
        startDate: '2026-12-01',
        endDate: '2026-12-20',
      })
    ).body;
    expect((await admin.post(`/api/admin/campaigns/${draft.id}/link`)).body.code).toBe(
      'CAMPAIGN_NOT_ACTIVE',
    );
    const id = await activeCampaign();
    expect((await admin.get(`/api/admin/campaigns/${id}/link`)).body).toBeNull();
    const first = (await admin.post(`/api/admin/campaigns/${id}/link`)).body.token as string;
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await admin.get(`/api/admin/campaigns/${id}/link`)).body.token).toBe(first);
    expect((await open(first)).body.state).toBe('OK');

    const second = (await admin.post(`/api/admin/campaigns/${id}/link`)).body.token as string;
    expect(second).not.toBe(first);
    const old = await open(first);
    expect(old.status).toBe(404);
    expect(old.body.code).toBe('INVALID_LINK');
    expect((await open('gibt-es-nicht')).body.code).toBe('INVALID_LINK');
    // Teilnahmekennung gilt je Kampagne, unabhängig vom Link (7.17)
    const again = await open(second);
    expect(again.body.state).toBe('OK');
  });

  it('zieht beim ersten Öffnen eine Teilmenge und liefert danach dieselbe (8.1, 8.11)', async () => {
    const id = await activeCampaign();
    const token = (await admin.post(`/api/admin/campaigns/${id}/link`)).body.token;
    const a1 = (await open(token)).body;
    expect(a1.items).toHaveLength(3);
    expect(a1.items[0]).toHaveProperty('perspective');
    const a2 = (await open(token)).body;
    expect(a2.items.map((i: { id: string }) => i.id)).toEqual(
      a1.items.map((i: { id: string }) => i.id),
    );
    // Öffnen speichert keine Antwort (8.13)
    expect((await sql`select count(*)::int as n from participation`)[0]!.n).toBe(0);
    // Deaktiviertes Item wird beim erneuten Öffnen weggelassen und nicht ersetzt (8.11)
    await sql`update snapshot_item set deactivated_at = now() where id = ${a1.items[0].id}`;
    expect((await open(token)).body.items).toHaveLength(2);
  });

  it('verlangt alle Bewertungen, speichert anonym und verhindert Mehrfachabgabe (8.5–8.10)', async () => {
    const id = await activeCampaign();
    const token = (await admin.post(`/api/admin/campaigns/${id}/link`)).body.token;
    const items = (await open(token)).body.items as { id: string }[];

    const missing = await submit(token, [{ snapshotItemId: items[0]!.id, rating: 3 }]);
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('MISSING_RATINGS');
    expect(missing.body.fieldErrors.missing.sort()).toEqual([items[1]!.id, items[2]!.id].sort());

    const range = await submit(
      token,
      items.map((i) => ({ snapshotItemId: i.id, rating: 5.5 })),
    );
    expect(range.status).toBe(422);
    expect(Object.keys(range.body.fieldErrors)[0]).toMatch(/^answers\.\d+\.rating$/);

    const ok = await submit(token, [
      { snapshotItemId: items[0]!.id, rating: 4.256, comment: '  Gutes Beispiel  ' },
      { snapshotItemId: items[1]!.id, rating: 1 },
      { snapshotItemId: items[2]!.id, rating: 5, comment: '' },
    ]);
    expect(ok.status).toBe(201);
    expect(ok.body.state).toBe('SUBMITTED');

    const answers = await sql<{ rating: number; comment: string | null }[]>`
      select rating, comment from answer_item order by rating`;
    expect(answers).toEqual([
      { rating: 1, comment: null },
      { rating: 4.26, comment: 'Gutes Beispiel' },
      { rating: 5, comment: null },
    ]);
    // Antwort ohne Verweis auf Kennung/Link und nur mit Kalendertag (7.19)
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'participation'`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['campaign_id', 'drawn_snapshot_item_ids', 'id', 'submission_seq', 'submitted_on'].sort(),
    );
    // Kennung nur als Hash, Sitzung gelöscht (8.14)
    const [marker] = await sql`select code_hash, status from participant_marker`;
    expect(marker).toEqual({ code_hash: participantHash(id, CODE_A), status: 'TEILGENOMMEN' });
    expect(JSON.stringify(await sql`select * from participant_marker`)).not.toContain(CODE_A);
    expect((await sql`select count(*)::int as n from survey_session`)[0]!.n).toBe(0);

    // Zweite Abgabe und erneutes Öffnen werden erkannt (7.4, 8.10)
    expect((await open(token)).body.state).toBe('ALREADY_PARTICIPATED');
    expect((await submit(token, [])).body.state).toBe('ALREADY_PARTICIPATED');
    // Ein anderer Browser kann teilnehmen; Abgabenummern laufen fortlaufend
    const itemsB = (await open(token, CODE_B)).body.items as { id: string }[];
    await submit(
      token,
      itemsB.map((i) => ({ snapshotItemId: i.id, rating: 3 })),
      CODE_B,
    );
    const seqs = await sql`select submission_seq from participation order by submission_seq`;
    expect(seqs.map((r) => r.submission_seq)).toEqual([1, 2]);
  });

  it('meldet bei nicht aktiver Kampagne einheitlich „nicht verfügbar" (7.11, 7.12, 8.8)', async () => {
    const id = await activeCampaign();
    const token = (await admin.post(`/api/admin/campaigns/${id}/link`)).body.token;
    const items = (await open(token)).body.items as { id: string }[];
    // Alle gezogenen Items deaktiviert → Absenden abgelehnt, nichts gespeichert
    await sql`update snapshot_item set deactivated_at = now() where id = any(${items.map((i) => i.id)}::uuid[])`;
    expect(
      (
        await submit(
          token,
          items.map((i) => ({ snapshotItemId: i.id, rating: 3 })),
        )
      ).body.state,
    ).toBe('UNAVAILABLE');
    expect((await open(token)).body.state).toBe('UNAVAILABLE');
    expect((await sql`select count(*)::int as n from participation`)[0]!.n).toBe(0);
    await admin.post(`/api/admin/campaigns/${id}/close`);
    expect((await open(token, CODE_B)).body).toEqual({ state: 'UNAVAILABLE' });
  });

  it('zieht ausgewogen je Wert und Perspektive und nennt die Zahl verfügbarer Fragen (8.18, 8.19)', async () => {
    const values: string[] = [];
    for (const name of ['Mut', 'Respekt', 'Klarheit']) {
      values.push((await admin.post('/api/admin/values', { name, description: '' })).body.id);
    }
    const ids: string[] = [];
    const valueOf = new Map<string, string>();
    for (const [vi, v] of values.entries()) {
      // Ungleich grosse Wertebestände: 12, 6 und 3 Fragen
      const n = [12, 6, 3][vi]!;
      for (let i = 0; i < n; i++) {
        const it = await admin.post('/api/admin/items', {
          text: `W${vi}-F${i}`,
          itemType: 'FRAGE',
          perspective: (['SELBST', 'TEAM', 'FUEHRUNG'] as const)[i % 3],
          // Nebenwert mit kleinerer Gewichtung zählt nicht als Hauptwert
          assignments: [
            { valueId: v, weight: 80 },
            { valueId: values[(vi + 1) % 3] ?? values[0]!, weight: 20 },
          ].filter((a, idx, arr) => arr.findIndex((b) => b.valueId === a.valueId) === idx),
        });
        await admin.post(`/api/admin/items/${it.body.id}/approve`);
        ids.push(it.body.id);
        valueOf.set(`W${vi}-F${i}`, v);
      }
    }
    const settings = { title: 'Balance', startDate: '2026-12-01', endDate: '2026-12-20' };
    const c = (await admin.post('/api/admin/campaigns', settings)).body;
    await admin.put(`/api/admin/campaigns/${c.id}/pool`, { itemIds: ids });
    await admin.put(`/api/admin/campaigns/${c.id}`, {
      ...settings,
      itemsPerParticipant: 9,
      anonymityThreshold: 3,
    });
    await admin.post(`/api/admin/campaigns/${c.id}/activate`);
    const token = (await admin.post(`/api/admin/campaigns/${c.id}/link`)).body.token;

    for (let run = 0; run < 8; run++) {
      const code = `${'c'.repeat(30)}${run.toString().padStart(2, '0')}`;
      const res = (await open(token, code)).body;
      expect(res.poolSize).toBe(21);
      expect(res.items).toHaveLength(9);
      expect(res.items[0]).not.toHaveProperty('primaryValueId');
      const perValue = new Map<string, number>();
      for (const it of res.items as { text: string }[]) {
        const v = valueOf.get(it.text)!;
        perValue.set(v, (perValue.get(v) ?? 0) + 1);
      }
      // 9 Plätze auf 3 Werte: je 3 (der kleinste Wert hat genau 3 Fragen)
      expect(values.map((v) => perValue.get(v) ?? 0)).toEqual([3, 3, 3]);
    }
  });

  it('verlangt für die Link-Verwaltung die Rolle Kampagnen-Administration', async () => {
    const id = await activeCampaign();
    await sql`update organization_member set roles = ${['WERTE']} where user_id = ${ADMIN.userId}`;
    expect((await admin.post(`/api/admin/campaigns/${id}/link`)).status).toBe(403);
  });
});
