import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { IconButton } from '../Icons';
import { ApiError, apiFetch } from '../lib/api';
import type { Value } from './types';

/** Unternehmenswerte und Fokussätze (Anforderung 2). */
export function ValuesPage() {
  const values = useQuery({
    queryKey: ['values'],
    queryFn: () => apiFetch<Value[]>('/admin/values'),
  });
  const [editing, setEditing] = useState<Value | 'new' | null>(null);

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Grundlage</span>
          <h1>Unternehmenswerte</h1>
          <p className="muted">
            Name, Beschreibung und Fokussätze beschreiben, wie sich ein gelebter Wert im Daily
            Business zeigt. Sie sind die Vorgabe für die Fragen der Umfrage.
          </p>
        </div>
        <button onClick={() => setEditing('new')}>Neuer Wert</button>
      </div>
      {editing && (
        <ValueForm value={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      )}
      {values.isLoading && <p className="muted">Laden …</p>}
      {values.error && <p className="error">{(values.error as Error).message}</p>}
      {values.data?.length === 0 && (
        <p className="empty">
          Es sind noch keine Unternehmenswerte vorhanden. Legen Sie den ersten Wert an.
        </p>
      )}
      <div className="cards">
        {values.data?.map((v) => (
          <ValueCard key={v.id} value={v} onEdit={() => setEditing(v)} />
        ))}
      </div>
    </section>
  );
}

function ValueForm({ value, onDone }: { value: Value | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(value?.name ?? '');
  const [description, setDescription] = useState(value?.description ?? '');
  const save = useMutation({
    mutationFn: () =>
      value
        ? apiFetch<Value>(`/admin/values/${value.id}`, {
            method: 'PUT',
            body: { name, description },
          })
        : apiFetch<Value>('/admin/values', { method: 'POST', body: { name, description } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['values'] });
      onDone();
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className="form panel" onSubmit={submit}>
      <h2>{value ? 'Wert bearbeiten' : 'Neuer Unternehmenswert'}</h2>
      <label>
        Name (1–100 Zeichen)
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <FieldError errors={err?.fieldErrors.name} />
      </label>
      <label>
        Beschreibung (bis 1.000 Zeichen)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={3}
        />
        <FieldError errors={err?.fieldErrors.description} />
      </label>
      {err && !err.fieldErrors.name && !err.fieldErrors.description && (
        <p className="error">{err.message}</p>
      )}
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          Speichern
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function ValueCard({ value, onEdit }: { value: Value; onEdit: () => void }) {
  const qc = useQueryClient();
  const [newSentence, setNewSentence] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['values'] });

  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/admin/values/${value.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
  const addSentence = useMutation({
    mutationFn: () =>
      apiFetch<Value>(`/admin/values/${value.id}/focus-sentences`, {
        method: 'POST',
        body: { text: newSentence },
      }),
    onSuccess: () => {
      setNewSentence('');
      void refresh();
    },
  });

  return (
    <article className="card">
      <header className="card-header">
        <h2>{value.name}</h2>
        <div className="actions">
          <IconButton
            icon="edit"
            label={`Unternehmenswert „${value.name}" bearbeiten`}
            onClick={onEdit}
          />
          <IconButton
            icon="delete"
            label={`Unternehmenswert „${value.name}" löschen`}
            onClick={() => {
              if (confirm(`Unternehmenswert „${value.name}" wirklich löschen?`)) remove.mutate();
            }}
          />
        </div>
      </header>
      {value.description && <p>{value.description}</p>}
      {remove.error && <p className="error">{(remove.error as Error).message}</p>}
      <h3>Fokussätze</h3>
      {value.focusSentences.length === 0 && (
        <p className="muted">
          Noch keine Fokussätze. Ohne Fokussatz ist keine KI-Generierung möglich.
        </p>
      )}
      <ul className="sentences">
        {value.focusSentences.map((s) => (
          <FocusSentenceRow key={s.id} id={s.id} text={s.text} onChanged={refresh} />
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          addSentence.mutate();
        }}
      >
        <input
          placeholder="Neuer Fokussatz (1–500 Zeichen)"
          value={newSentence}
          maxLength={500}
          onChange={(e) => setNewSentence(e.target.value)}
        />
        <button type="submit" disabled={addSentence.isPending}>
          Hinzufügen
        </button>
      </form>
      {addSentence.error && <p className="error">{firstError(addSentence.error)}</p>}
    </article>
  );
}

function FocusSentenceRow({
  id,
  text,
  onChanged,
}: {
  id: string;
  text: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/focus-sentences/${id}`, { method: 'PUT', body: { text: draft } }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/admin/focus-sentences/${id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  if (editing) {
    return (
      <li>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <input value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit">Speichern</button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Abbrechen
          </button>
        </form>
        {save.error && <p className="error">{firstError(save.error)}</p>}
      </li>
    );
  }
  return (
    <li className="sentence">
      <span>{text}</span>
      <span className="actions">
        <IconButton icon="edit" label="Fokussatz bearbeiten" onClick={() => setEditing(true)} />
        <IconButton
          icon="delete"
          label="Fokussatz löschen"
          onClick={() => {
            if (confirm('Fokussatz wirklich löschen?')) remove.mutate();
          }}
        />
      </span>
    </li>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="field-error">{errors[0]}</span>;
}

export function firstError(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.fieldErrors)[0]?.[0];
    return first ?? error.message;
  }
  return (error as Error).message;
}
