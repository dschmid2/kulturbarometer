/** Regeln für das Ändern des Passworts (Anforderung 1.7–1.9). */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/**
 * Prüft die Eingaben vor dem Absenden; `current: null` = Passwort festlegen ohne bisheriges
 * Passwort (nach Einladung oder Wiederherstellung). Die Stärke prüft zusätzlich Supabase Auth.
 */
export function validatePasswordChange(input: {
  current: string | null;
  next: string;
  repeat: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.current !== null && input.current === '')
    errors.current = 'Bitte das aktuelle Passwort eingeben.';
  if (input.next.length < PASSWORD_MIN)
    errors.next = `Das neue Passwort muss mindestens ${PASSWORD_MIN} Zeichen lang sein.`;
  else if (input.next.length > PASSWORD_MAX)
    errors.next = `Das neue Passwort darf höchstens ${PASSWORD_MAX} Zeichen lang sein.`;
  else if (input.current !== null && input.next === input.current)
    errors.next = 'Das neue Passwort muss sich vom aktuellen unterscheiden.';
  if (input.repeat !== input.next) errors.repeat = 'Die Passwörter stimmen nicht überein.';
  return errors;
}
