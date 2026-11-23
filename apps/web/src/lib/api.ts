import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

/** Wird aufgerufen, wenn das Backend 401 meldet (Sitzung abgelaufen oder ungültig). */
let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

/** Aktive Unternehmung; wird bei jeder Admin-Anfrage als `X-Organization-Id` mitgeschickt (12). */
let activeOrganizationId: string | null = null;
export function setActiveOrganizationId(id: string | null) {
  activeOrganizationId = id;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(path.startsWith('/admin') ? await authHeader() : {}),
      ...(path.startsWith('/admin') && activeOrganizationId
        ? { 'X-Organization-Id': activeOrganizationId }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthenticated();
    throw new ApiError(
      res.status,
      data.code ?? 'ERROR',
      data.message ?? 'Unbekannter Fehler.',
      data.fieldErrors,
    );
  }
  return data as T;
}
