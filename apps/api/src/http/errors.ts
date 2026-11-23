import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** Fachlicher Fehler mit stabilem Code für das Frontend. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `${what} wurde nicht gefunden.`);

/** Fehler aus Datenbank-Triggern haben die Form „CODE: Meldung" (siehe supabase/migrations). */
function fromPostgres(err: {
  code?: string;
  message?: string;
  constraint_name?: string;
}): AppError | null {
  if (err.code === 'P0001' && err.message) {
    const match = /^([A-Z_]+): (.*)$/s.exec(err.message);
    if (match) return new AppError(409, match[1]!, match[2]!);
  }
  if (err.code === '22P02')
    return new AppError(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');
  if (err.code === '23505') return new AppError(409, 'DUPLICATE', 'Der Eintrag existiert bereits.');
  if (err.code === '23503')
    return new AppError(409, 'REFERENCED', 'Der Eintrag wird noch verwendet.');
  if (err.code === '23514') return new AppError(422, 'CONSTRAINT', 'Die Eingabe ist ungültig.');
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    res.status(422).json({ code: 'VALIDATION', message: 'Die Eingabe ist ungültig.', fieldErrors });
    return;
  }
  const appError = err instanceof AppError ? err : fromPostgres(err ?? {});
  if (appError) {
    res.status(appError.status).json({
      code: appError.code,
      message: appError.message,
      ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
    });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL', message: 'Ein unerwarteter Fehler ist aufgetreten.' });
};
