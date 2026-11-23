import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { errorHandler } from './http/errors.js';

/** Erzeugt die Express-App mit getrennten Routern für Administration und Teilnahme (1.4). */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const admin = Router();
  // AuthGuard und Admin-Routen folgen in Aufgabe 4 ff.
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
