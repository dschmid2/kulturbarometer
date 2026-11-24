import { describe, expect, it } from 'vitest';
import { validatePasswordChange } from './password.js';

describe('Passwort ändern (1.7–1.9)', () => {
  it('akzeptiert gültige Eingaben', () => {
    expect(
      validatePasswordChange({
        current: 'alt-passwort',
        next: 'neu-passwort-1',
        repeat: 'neu-passwort-1',
      }),
    ).toEqual({});
    expect(
      validatePasswordChange({ current: null, next: 'neu-passwort-1', repeat: 'neu-passwort-1' }),
    ).toEqual({});
  });

  it('verlangt das aktuelle Passwort ausser beim Festlegen', () => {
    expect(
      validatePasswordChange({ current: '', next: 'neu-passwort-1', repeat: 'neu-passwort-1' })
        .current,
    ).toBeDefined();
  });

  it('prüft Länge, Wiederholung und Unterschied zum aktuellen Passwort', () => {
    expect(validatePasswordChange({ current: 'x', next: 'kurz', repeat: 'kurz' }).next).toMatch(
      /mindestens 8/,
    );
    expect(
      validatePasswordChange({ current: 'x', next: 'a'.repeat(73), repeat: 'a'.repeat(73) }).next,
    ).toMatch(/höchstens 72/);
    expect(
      validatePasswordChange({ current: 'gleich-123', next: 'gleich-123', repeat: 'gleich-123' })
        .next,
    ).toMatch(/unterscheiden/);
    expect(
      validatePasswordChange({ current: 'x', next: 'neu-passwort-1', repeat: 'anders-1234' })
        .repeat,
    ).toBeDefined();
  });
});
