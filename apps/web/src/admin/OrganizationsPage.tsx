import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { IconButton } from '../Icons';
import { ApiError, apiFetch } from '../lib/api';
import type { Organization } from './types';
import { FieldError, firstError } from './ValuesPage';
import { useWorkspace } from './workspace';

/** Unternehmungen anlegen und umbenennen – nur für Plattform-Administratoren (Anforderung 12). */
export function OrganizationsPage() {
  const { selectOrg, org } = useWorkspace();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['me-organizations'],
    queryFn: () => apiFetch<Organization[]>('/admin/organizations'),
  });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<Organization>('/admin/organizations', { method: 'POST', body: { name } }),
    onSuccess: async (o) => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['me-organizations'] });
      selectOrg(o.id);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Plattform</span>
          <h1>Unternehmungen</h1>
          <p className="muted">
            Jede Unternehmung hat eigene Werte, Fragen, Kampagnen und Benutzer. Als
            Plattform-Administrator haben Sie in allen Unternehmungen alle Rollen.
          </p>
        </div>
      </div>
      <form className="form panel" onSubmit={submit}>
        <h2>Neue Unternehmung</h2>
        <div className="inline-form">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name der Unternehmung"
            maxLength={200}
            aria-label="Name der Unternehmung"
          />
          <button type="submit" disabled={create.isPending}>
            Anlegen
          </button>
        </div>
        <FieldError errors={err?.fieldErrors.name} />
      </form>
      {list.isLoading && <p className="muted">Laden …</p>}
      {list.data?.length === 0 && <p className="empty">Noch keine Unternehmung angelegt.</p>}
      <div className="cards">
        {list.data?.map((o) => (
          <OrganizationCard
            key={o.id}
            organization={o}
            active={o.id === org?.id}
            onSelect={() => selectOrg(o.id)}
          />
        ))}
      </div>
    </section>
  );
}

function OrganizationCard({
  organization,
  active,
  onSelect,
}: {
  organization: Organization;
  active: boolean;
  onSelect: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(organization.name);
  const rename = useMutation({
    mutationFn: () =>
      apiFetch<Organization>(`/admin/organizations/${organization.id}`, {
        method: 'PUT',
        body: { name },
      }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['me-organizations'] });
    },
  });

  return (
    <article className={`card ${active ? 'card-selected' : ''}`}>
      <header className="card-header">
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              aria-label="Neuer Name"
            />
            <button type="submit">Speichern</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </form>
        ) : (
          <div>
            <h2>{organization.name}</h2>
            <span className="muted small">
              {organization.memberCount} {organization.memberCount === 1 ? 'Benutzer' : 'Benutzer'}
              {active && ' · aktive Unternehmung'}
            </span>
          </div>
        )}
        {!editing && (
          <div className="actions">
            {!active && (
              <button className="secondary small" onClick={onSelect}>
                Wechseln
              </button>
            )}
            <IconButton
              icon="edit"
              label={`${organization.name} umbenennen`}
              onClick={() => setEditing(true)}
            />
          </div>
        )}
      </header>
      {rename.error && <p className="error">{firstError(rename.error)}</p>}
    </article>
  );
}
