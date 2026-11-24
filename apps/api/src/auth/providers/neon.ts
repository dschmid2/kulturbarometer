/**
 * Anmeldedienst Neon Auth (Managed Better Auth). Einzige Stelle im Backend, die Neon Auth kennt.
 *
 * - Der Browser spricht Neon Auth über unseren eigenen Pfad `/api/auth/*` an. Das Backend reicht
 *   die Anfragen an Neon weiter (`@neon/auth/server`), damit die Sitzungs-Cookies auf unserer
 *   Domain liegen (keine Drittanbieter-Cookies, funktioniert auch in Safari).
 * - Zugriffstokens sind JWTs (EdDSA), geprüft gegen den JWKS-Endpunkt von Neon Auth.
 * - Konten liegen in der Tabelle `neon_auth.user` derselben Datenbank.
 * - Einladungen: Konto über die Neon-API anlegen, danach eine E-Mail zum Festlegen des Passworts.
 *
 * Variablen: `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (mind. 32 Zeichen); für Einladungen
 * zusätzlich `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID`.
 */
import { handleAuthRequest, handleAuthResponse } from '@neon/auth/server';
import express, { Router, type Request as ExpressRequest } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Sql } from '../../db/client.js';
import { AppError } from '../../http/errors.js';
import type { AuthProvider, DirectoryUser } from '../provider.js';

/** Neon-API; in Tests über `NEON_API_URL` ersetzbar. */
const neonApi = () => process.env.NEON_API_URL ?? 'https://console.neon.tech/api/v2';

/** Pfad, unter dem die Anmeldung im Browser erreichbar ist (siehe Frontend `lib/auth/neon.ts`). */
export const NEON_AUTH_PROXY_PATH = '/api/auth';

/** Wandelt eine Express-Anfrage in eine Web-`Request` für den Neon-Proxy. */
function toWebRequest(req: ExpressRequest): Request {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body);
  return new Request(url, {
    method: req.method,
    headers,
    body:
      hasBody && (req.body as Buffer).length > 0 ? new Uint8Array(req.body as Buffer) : undefined,
  });
}

export function neonAuthProvider(sql: () => Sql): AuthProvider {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/$/, '');
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl) throw new Error('NEON_AUTH_BASE_URL muss gesetzt sein.');
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error('NEON_AUTH_COOKIE_SECRET muss gesetzt sein (mindestens 32 Zeichen).');
  }
  const origin = new URL(baseUrl).origin;
  const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`));

  async function findByEmail(email: string): Promise<DirectoryUser | null> {
    const [row] = await sql()<DirectoryUser[]>`
      select id::text as id, email from neon_auth."user"
      where lower(email) = lower(${email}) limit 1`;
    return row ?? null;
  }

  const routes = Router();
  // Rohdaten weiterreichen; JSON wird erst bei Neon ausgewertet.
  routes.use(express.raw({ type: '*/*', limit: '100kb' }));
  routes.all('/{*path}', async (req, res) => {
    const path = req.path.replace(/^\//, '');
    // Bewusst ohne den Sitzungs-Cache des SDK (Cookie `session_data`): Dieser ist für
    // Next.js-Serverkomponenten gedacht und liefert kein JWT. Jede Sitzungsabfrage geht an
    // Neon, damit der Browser das aktuelle JWT (Header `set-auth-jwt`) für unser Backend erhält.
    const upstream = await handleAuthRequest(baseUrl, toWebRequest(req), path);
    const response = await handleAuthResponse(upstream, baseUrl, {
      secret: cookieSecret,
      sameSite: 'lax',
    });
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    // Komprimierung übernimmt fetch bereits; die Länge stimmt danach nicht mehr.
    res.removeHeader('content-encoding');
    res.send(Buffer.from(await response.arrayBuffer()));
  });

  return {
    name: 'neon',
    routes,
    async verifyToken(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ['EdDSA'],
          issuer: origin,
          audience: origin,
        });
        if (!payload.sub) return null;
        return { userId: payload.sub, email: (payload.email as string | undefined) ?? null };
      } catch {
        return null;
      }
    },
    directory: {
      findByEmail,
      async invite(email, redirectTo) {
        const apiKey = process.env.NEON_API_KEY;
        const project = process.env.NEON_PROJECT_ID;
        const branch = process.env.NEON_BRANCH_ID;
        if (!apiKey || !project || !branch) return null;

        const created = await fetch(
          `${neonApi()}/projects/${project}/branches/${branch}/auth/users`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name: email.split('@')[0] }),
          },
        );
        if (!created.ok) {
          throw new AppError(
            502,
            'INVITE_FAILED',
            `Das Konto konnte nicht angelegt werden (Neon: ${created.status}).`,
          );
        }
        const user = await findByEmail(email);
        if (!user) throw new AppError(502, 'INVITE_FAILED', 'Das neue Konto wurde nicht gefunden.');

        // E-Mail mit Link zum Festlegen des Passworts (Neon Auth versendet sie).
        if (redirectTo) {
          const appOrigin = new URL(redirectTo).origin;
          const reset = await fetch(`${baseUrl}/request-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: appOrigin },
            body: JSON.stringify({ email, redirectTo: `${appOrigin}/admin?einladung=1` }),
          });
          if (!reset.ok) {
            throw new AppError(
              502,
              'INVITE_FAILED',
              `Das Konto wurde angelegt, die E-Mail zum Festlegen des Passworts aber nicht versendet (Neon: ${reset.status}).`,
            );
          }
        }
        return user;
      },
    },
  };
}
