import { afterEach, describe, expect, it } from 'vitest';
import { authProviderFromEnv } from '../src/auth/provider.js';

describe('Wahl des Anmeldedienstes', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('lehnt unbekannte Anbieter mit klarer Meldung ab', () => {
    process.env.AUTH_PROVIDER = 'unbekannt';
    expect(() => authProviderFromEnv(() => undefined as never)).toThrow(
      /Unbekannter AUTH_PROVIDER/,
    );
  });

  it('verlangt für Supabase die nötigen Variablen', () => {
    process.env.AUTH_PROVIDER = 'supabase';
    delete process.env.SUPABASE_URL;
    expect(() => authProviderFromEnv(() => undefined as never)).toThrow(/SUPABASE_URL/);
  });
});
