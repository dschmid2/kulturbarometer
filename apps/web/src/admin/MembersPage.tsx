import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from '@kb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { IconButton } from '../Icons';
import { ApiError, apiFetch } from '../lib/api';
import type { Member } from './types';
import { FieldError, firstError } from './ValuesPage';
import { useWorkspace } from './workspace';

/** Benutzer der aktiven Unternehmung und ihre Rollen verwalten (Anforderung 12). */
export function MembersPage() {
  const { org, me } = useWorkspace();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => apiFetch<Member[]>('/admin/members'),
  });

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">{org?.name}</span>
          <h1>Benutzer</h1>
          <p className="muted">
            Ordnen Sie Personen dieser Unternehmung zu und vergeben Sie Rollen. Eine Person kann
            mehrere Rollen haben.
          </p>
        </div>
      </div>
      <ul className="role-legend">
        {ROLES.map((r) => (
          <li key={r}>
            <strong>{ROLE_LABELS[r]}</strong> – {ROLE_DESCRIPTIONS[r]}
          </li>
        ))}
      </ul>
      <AddMemberForm />
      {members.isLoading && <p className="muted">Laden …</p>}
      {members.error && <p className="error">{firstError(members.error)}</p>}
      {members.data?.length === 0 && (
        <p className="empty">Dieser Unternehmung ist noch niemand zugeordnet.</p>
      )}
      <div className="cards">
        {members.data?.map((m) => (
          <MemberCard key={m.userId} member={m} isSelf={m.userId === me.userId} />
        ))}
      </div>
    </section>
  );
}

function RoleCheckboxes({ roles, onChange }: { roles: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <div className="role-checks">
      {ROLES.map((r) => (
        <label key={r} className="check">
          <input
            type="checkbox"
            checked={roles.includes(r)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? ROLES.filter((x) => x === r || roles.includes(x))
                  : roles.filter((x) => x !== r),
              )
            }
          />
          {ROLE_LABELS[r]}
        </label>
      ))}
    </div>
  );
}

function AddMemberForm() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Role[]>(['WERTE']);
  const [notice, setNotice] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      apiFetch<Member & { invited: boolean }>('/admin/members', {
        method: 'POST',
        body: { email, roles },
      }),
    onSuccess: (m) => {
      setNotice(
        m.invited
          ? `${m.email} wurde per E-Mail eingeladen und der Unternehmung zugeordnet.`
          : `${m.email} wurde der Unternehmung zugeordnet.`,
      );
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
  const err = add.error instanceof ApiError ? add.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    add.mutate();
  };

  return (
    <form className="form panel" onSubmit={submit}>
      <h2>Benutzer hinzufügen</h2>
      <label>
        E-Mail-Adresse
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@unternehmung.ch"
          required
        />
        <FieldError errors={err?.fieldErrors.email} />
      </label>
      <fieldset>
        <legend>Rollen</legend>
        <RoleCheckboxes roles={roles} onChange={setRoles} />
        <FieldError errors={err?.fieldErrors.roles} />
      </fieldset>
      {err && !err.fieldErrors.email && !err.fieldErrors.roles && (
        <p className="error">{err.message}</p>
      )}
      {err?.code === 'USER_NOT_FOUND' && <p className="hint">{err.message}</p>}
      {notice && <p className="info">{notice}</p>}
      <div className="actions">
        <button type="submit" disabled={add.isPending || roles.length === 0}>
          Hinzufügen
        </button>
      </div>
    </form>
  );
}

function MemberCard({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<Role[]>(member.roles);
  const changed = roles.join() !== member.roles.join();
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Member>(`/admin/members/${member.userId}`, { method: 'PUT', body: { roles } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/admin/members/${member.userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  return (
    <article className="card">
      <header className="card-header">
        <div>
          <h2>{member.email}</h2>
          {isSelf && <span className="muted small">Ihr Konto</span>}
        </div>
        <div className="actions">
          {changed && (
            <button
              className="small"
              disabled={save.isPending || roles.length === 0}
              onClick={() => save.mutate()}
            >
              Rollen speichern
            </button>
          )}
          <IconButton
            icon="delete"
            label={`${member.email} aus der Unternehmung entfernen`}
            onClick={() => {
              if (confirm(`${member.email} wirklich aus der Unternehmung entfernen?`))
                remove.mutate();
            }}
          />
        </div>
      </header>
      <RoleCheckboxes roles={roles} onChange={setRoles} />
      {roles.length === 0 && <p className="field-error">Mindestens eine Rolle wählen.</p>}
      {(save.error || remove.error) && (
        <p className="error">{firstError(save.error ?? remove.error)}</p>
      )}
    </article>
  );
}
