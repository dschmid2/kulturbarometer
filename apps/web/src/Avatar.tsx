import { useEffect, useState } from 'react';

/** SHA-256 der normalisierten E-Mail-Adresse, wie von Gravatar verlangt. */
async function gravatarHash(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Profilbild von Gravatar, falls vorhanden; sonst ein Kreis mit dem Anfangsbuchstaben.
 * An Gravatar geht nur der Hash der E-Mail-Adresse (`d=404`: kein Standardbild).
 */
export function Avatar({ email, size = 32 }: { email: string | null | undefined; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUrl(null);
    if (!email || !globalThis.crypto?.subtle) return;
    void gravatarHash(email).then((hash) => {
      if (!cancelled) setUrl(`https://www.gravatar.com/avatar/${hash}?s=${size * 2}&d=404`);
    });
    return () => {
      cancelled = true;
    };
  }, [email, size]);

  const initial = (email ?? '?').trim().charAt(0).toUpperCase() || '?';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };

  if (url && !failed) {
    return (
      <img
        className="avatar"
        src={url}
        alt=""
        width={size}
        height={size}
        style={style}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="avatar avatar-initial" style={style} aria-hidden="true">
      {initial}
    </span>
  );
}
