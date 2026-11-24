import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { neonAuthProvider } from '../src/auth/providers/neon.js';

/** Schein-Neon: JWKS, Better-Auth-Endpunkte und Konten-API, damit ohne Netz getestet werden kann. */
let server: Server;
let base: string;
let privateKey: CryptoKey;
const seen: { path: string; origin?: string; cookie?: string; body?: string; auth?: string }[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'EdDSA' };
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({
        path: req.url ?? '',
        origin: req.headers.origin,
        cookie: req.headers.cookie,
        body,
        auth: req.headers.authorization,
      });
      if (req.url === '/neondb/auth/.well-known/jwks.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [jwk] }));
      } else if (req.url === '/neondb/auth/sign-in/email') {
        res.setHeader('content-type', 'application/json');
        res.setHeader(
          'set-cookie',
          '__Secure-neon-auth.session_token=abc; Path=/; HttpOnly; Secure',
        );
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url?.startsWith('/api/v2/projects/p1/branches/b1/auth/users')) {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 'u-neu' }));
      } else if (req.url === '/neondb/auth/request-password-reset') {
        res.end(JSON.stringify({ status: true }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  process.env.NEON_AUTH_BASE_URL = `${base}/neondb/auth`;
  process.env.NEON_AUTH_COOKIE_SECRET = 'x'.repeat(32);
  process.env.NEON_API_URL = `${base}/api/v2`;
});
afterAll(() => {
  server?.close();
});

const sign = (claims: Record<string, unknown>, opts: { iss?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(opts.iss ?? base)
    .setAudience(opts.iss ?? base)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '15m')
    .sign(privateKey);

describe('Anmeldedienst Neon Auth', () => {
  it('verlangt Basis-URL und ein ausreichend langes Cookie-Geheimnis', () => {
    const saved = process.env.NEON_AUTH_COOKIE_SECRET;
    process.env.NEON_AUTH_COOKIE_SECRET = 'kurz';
    expect(() => neonAuthProvider(() => undefined as never)).toThrow(/32 Zeichen/);
    process.env.NEON_AUTH_COOKIE_SECRET = saved;
  });

  it('prüft JWTs gegen den JWKS-Endpunkt (Signatur, Aussteller, Ablauf)', async () => {
    const p = neonAuthProvider(() => undefined as never);
    expect(await p.verifyToken(await sign({ email: 'a@example.org' }))).toEqual({
      userId: 'user-1',
      email: 'a@example.org',
    });
    expect(await p.verifyToken(await sign({}, { iss: 'https://fremd.example' }))).toBeNull();
    expect(await p.verifyToken(await sign({}, { exp: '-1m' }))).toBeNull();
    expect(await p.verifyToken('kein.jwt.token')).toBeNull();
  });

  it('leitet /api/auth an Neon weiter und behält Cookies auf der eigenen Domain', async () => {
    const app = createApp({
      sql: () => undefined as never,
      auth: neonAuthProvider(() => undefined as never),
    });
    const res = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', 'https://wertebarometer.vercel.app')
      .set('Content-Type', 'application/json')
      .send({ email: 'a@example.org', password: 'geheim123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const upstream = seen.find((s) => s.path === '/neondb/auth/sign-in/email')!;
    expect(upstream.origin).toBe('https://wertebarometer.vercel.app');
    expect(JSON.parse(upstream.body!)).toEqual({ email: 'a@example.org', password: 'geheim123' });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.includes('session_token'))!;
    expect(session).toBeDefined();
    expect(session).not.toMatch(/Domain=/i);
  });

  it('lädt neue Konten über die Neon-API ein und verschickt den Link zum Passwortsetzen', async () => {
    process.env.NEON_API_KEY = 'test-key';
    process.env.NEON_PROJECT_ID = 'p1';
    process.env.NEON_BRANCH_ID = 'b1';
    let lookups = 0;
    const fakeSql = (() => async () =>
      lookups++ === 0 ? [{ id: 'u-neu', email: 'neu@example.org' }] : []) as never;
    const p = neonAuthProvider(fakeSql);
    const user = await p.directory.invite(
      'neu@example.org',
      'https://wertebarometer.vercel.app/admin',
    );
    expect(user).toEqual({ id: 'u-neu', email: 'neu@example.org' });
    const create = seen.find((s) => s.path.endsWith('/auth/users'))!;
    expect(create.auth).toBe('Bearer test-key');
    const reset = seen.find((s) => s.path === '/neondb/auth/request-password-reset')!;
    expect(reset.origin).toBe('https://wertebarometer.vercel.app');
    expect(JSON.parse(reset.body!).redirectTo).toBe(
      'https://wertebarometer.vercel.app/admin?einladung=1',
    );
  });

  it('lädt ohne Neon-API-Zugang nicht ein', async () => {
    delete process.env.NEON_API_KEY;
    const p = neonAuthProvider(() => undefined as never);
    expect(await p.directory.invite('x@example.org')).toBeNull();
  });
});
