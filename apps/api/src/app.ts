import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { authGuard, orgContext, supabaseVerifyToken, type VerifyToken } from './auth/guard.js';
import { db, type Sql } from './db/client.js';
import { errorHandler } from './http/errors.js';
import { itemsRouter } from './modules/items.js';
import {
  accountRouter,
  membersRouter,
  supabaseUserDirectory,
  type UserDirectory,
} from './modules/organizations.js';
import { valuesRouter } from './modules/values.js';

export interface AppOptions {
  /** Datenbankzugriff; Standard ist die Verbindung aus DATABASE_URL. */
  sql?: () => Sql;
  /** Token-Prüfung; Standard ist Supabase Auth. */
  verifyToken?: VerifyToken;
  /** Benutzerkonten nachschlagen und einladen; Standard ist Supabase Auth. */
  userDirectory?: UserDirectory;
}

/** Erzeugt die Express-App mit getrennten Routern für Administration und Teilnahme (1.4). */
export function createApp(options: AppOptions = {}) {
  const sql = options.sql ?? db;
  let verify = options.verifyToken;
  const lazyVerify: VerifyToken = (token) => (verify ??= supabaseVerifyToken())(token);
  let directory = options.userDirectory;
  const lazyDirectory = () => (directory ??= supabaseUserDirectory(sql));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (req, res) => {
    // Mit ?db=1 wird zusätzlich die Datenbankverbindung geprüft (ohne Daten preiszugeben).
    if (req.query.db !== '1') {
      res.json({ ok: true });
      return;
    }
    try {
      await sql()`select 1`;
      res.json({ ok: true, database: 'ok' });
    } catch (err) {
      // Nur Fehlercode und Meldung protokollieren; die Verbindungsdaten erscheinen darin nicht.
      const e = err as { code?: string; message?: string };
      console.error('Datenbank nicht erreichbar:', e.code, e.message);
      res
        .status(503)
        .json({ ok: false, database: 'nicht erreichbar', code: e.code ?? 'UNBEKANNT' });
    }
  });

  // Administration: Anmeldung (1.4); danach Konto-Routen ohne und Fachrouten mit Unternehmungs-Kontext (12).
  const admin = Router();
  admin.use(authGuard(lazyVerify));
  admin.use(accountRouter(sql));
  const scoped = Router();
  scoped.use(orgContext(sql));
  scoped.use(valuesRouter(sql));
  scoped.use(itemsRouter(sql));
  scoped.use(membersRouter(sql, lazyDirectory));
  admin.use(scoped);
  app.use('/api/admin', admin);

  const publicRouter = Router();
  // Teilnahme-Routen folgen in Aufgabe 10 und 11.
  app.use('/api/public', publicRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Unbekannter Endpunkt.' });
  });
  app.use(errorHandler);
  return app;
}
