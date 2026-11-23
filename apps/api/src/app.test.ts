import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('API-Grundgerüst', () => {
  it('antwortet auf den Health-Check', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('liefert 404 als JSON für unbekannte Endpunkte', async () => {
    const res = await request(createApp()).get('/api/gibt-es-nicht');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
