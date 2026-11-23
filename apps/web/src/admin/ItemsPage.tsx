import {
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  PERSPECTIVE_LABELS,
  PERSPECTIVES,
  type ItemStatus,
  type ItemType,
  type Perspective,
} from '@kb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import type { Item, Value } from './types';
import { FieldError, firstError } from './ValuesPage';

/** Items verwalten, Freigabe-Workflow und Versionen (Anforderung 5). */
export function ItemsPage() {
  const [valueId, setValueId] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const values = useQuery({
    queryKey: ['values'],
    queryFn: () => apiFetch<Value[]>('/admin/values'),
  });
  const params = new URLSearchParams({
    ...(valueId ? { valueId } : {}),
    ...(status ? { status } : {}),
  });
  const items = useQuery({
    queryKey: ['items', valueId, status],
    queryFn: () => apiFetch<Item[]>(`/admin/items?${params}`),
  });

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Umfrage</span>
          <h1>Items</h1>
          <p className="muted">
            Fragen und Situationen aus der Sicht Selbst, Team oder Führung – gewichtet den
            Unternehmenswerten zugeordnet. Nur freigegebene Items können in Kampagnen verwendet
            werden.
          </p>
        </div>
        <button onClick={() => setEditing('new')} disabled={!values.data?.length}>
          Neues Item
        </button>
      </div>
      {values.data?.length === 0 && <p className="empty">Legen Sie zuerst Unternehmenswerte an.</p>}
      <div className="filters">
        <label>
          Unternehmenswert
          <select value={valueId} onChange={(e) => setValueId(e.target.value)}>
            <option value="">Alle</option>
            {values.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | '')}>
            <option value="">Alle</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ITEM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {editing && values.data && (
        <ItemForm
          item={editing === 'new' ? null : editing}
          values={values.data}
          onDone={() => setEditing(null)}
        />
      )}
      {items.isLoading && <p className="muted">Laden …</p>}
      {items.data?.length === 0 && <p className="empty">Keine Items gefunden.</p>}
      <div className="cards">
        {items.data?.map((item) => (
          <ItemCard key={item.id} item={item} onEdit={() => setEditing(item)} />
        ))}
      </div>
    </section>
  );
}

function ItemCard({ item, onEdit }: { item: Item; onEdit: () => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['items'] });
  const action = useMutation({
    mutationFn: async (kind: 'approve' | 'deactivate' | 'delete'): Promise<void> => {
      if (kind === 'delete') await apiFetch<void>(`/admin/items/${item.id}`, { method: 'DELETE' });
      else await apiFetch<Item>(`/admin/items/${item.id}/${kind}`, { method: 'POST' });
    },
    onSuccess: refresh,
  });

  return (
    <article className="card">
      <header className="card-header">
        <div className="badges">
          <span className={`badge status-${item.status}`}>{ITEM_STATUS_LABELS[item.status]}</span>
          <span className={`badge persp-${item.perspective}`}>
            {PERSPECTIVE_LABELS[item.perspective]}
          </span>
          <span className="badge">{ITEM_TYPE_LABELS[item.itemType]}</span>
          <span className="badge muted">Version {item.versionNumber}</span>
          {item.used && (
            <span
              className="badge muted"
              title="In einer aktivierten Kampagne verwendet, unveränderlich"
            >
              verwendet
            </span>
          )}
        </div>
        <div className="actions">
          <button className="secondary small" onClick={onEdit}>
            {item.used ? 'Neue Version' : 'Bearbeiten'}
          </button>
          {item.status !== 'FREIGEGEBEN' && (
            <button className="small" onClick={() => action.mutate('approve')}>
              Freigeben
            </button>
          )}
          {item.status === 'FREIGEGEBEN' && (
            <button className="secondary small" onClick={() => action.mutate('deactivate')}>
              Deaktivieren
            </button>
          )}
          {!item.used && (
            <button
              className="danger small"
              onClick={() => {
                if (confirm('Item wirklich löschen?')) action.mutate('delete');
              }}
            >
              Löschen
            </button>
          )}
        </div>
      </header>
      <p className="item-text">{item.text}</p>
      <p className="muted small">
        {item.assignments.map((a) => `${a.valueName} ${a.weight} %`).join(' · ') ||
          'Keine Werte-Zuordnung'}
      </p>
      {action.error && <p className="error">{firstError(action.error)}</p>}
    </article>
  );
}

interface AssignmentDraft {
  valueId: string;
  weight: string;
}

function ItemForm({
  item,
  values,
  onDone,
}: {
  item: Item | null;
  values: Value[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(item?.text ?? '');
  const [itemType, setItemType] = useState<ItemType>(item?.itemType ?? 'FRAGE');
  const [perspective, setPerspective] = useState<Perspective>(item?.perspective ?? 'SELBST');
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(
    item?.assignments.map((a) => ({ valueId: a.valueId, weight: String(a.weight) })) ?? [
      { valueId: values[0]?.id ?? '', weight: '100' },
    ],
  );
  const [notice, setNotice] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        text,
        itemType,
        perspective,
        assignments: assignments.map((a) => ({ valueId: a.valueId, weight: Number(a.weight) })),
      };
      return item
        ? apiFetch<Item & { newVersion: boolean }>(`/admin/items/${item.id}`, {
            method: 'PUT',
            body,
          })
        : apiFetch<Item>('/admin/items', { method: 'POST', body });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      if ('newVersion' in saved && saved.newVersion) {
        setNotice(
          `Gespeichert als neue Version ${saved.versionNumber} im Status „zur Prüfung". Die verwendete Version bleibt unverändert.`,
        );
        setTimeout(onDone, 2500);
      } else onDone();
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const update = (i: number, patch: Partial<AssignmentDraft>) =>
    setAssignments((list) => list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <form className="form panel" onSubmit={submit}>
      <h2>{item ? (item.used ? 'Neue Version anlegen' : 'Item bearbeiten') : 'Neues Item'}</h2>
      {item?.used && (
        <p className="info">
          Diese Version wurde in einer Kampagne verwendet und ist unveränderlich. Beim Speichern
          entsteht eine neue Version im Status „zur Prüfung".
        </p>
      )}
      <label>
        Text (1–500 Zeichen)
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} />
        <FieldError errors={err?.fieldErrors.text} />
      </label>
      <div className="row">
        <label>
          Perspektive
          <select
            value={perspective}
            onChange={(e) => setPerspective(e.target.value as Perspective)}
          >
            {PERSPECTIVES.map((p) => (
              <option key={p} value={p}>
                {PERSPECTIVE_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="hint">Die Formulierung sollte die Perspektive ausdrücken.</span>
        </label>
        <label>
          Item-Typ
          <select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Werte-Zuordnungen (Gewichtung 0–100 %, mindestens eine &gt; 0 %)</legend>
        {assignments.map((a, i) => (
          <div className="inline-form" key={i}>
            <select value={a.valueId} onChange={(e) => update(i, { valueId: e.target.value })}>
              {values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={a.weight}
              onChange={(e) => update(i, { weight: e.target.value })}
              aria-label="Gewichtung in Prozent"
            />
            <span>%</span>
            <button
              type="button"
              className="link danger"
              onClick={() => setAssignments((l) => l.filter((_, idx) => idx !== i))}
            >
              Entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link"
          onClick={() =>
            setAssignments((l) => [
              ...l,
              {
                valueId:
                  values.find((v) => !l.some((x) => x.valueId === v.id))?.id ?? values[0]!.id,
                weight: '50',
              },
            ])
          }
        >
          + Zuordnung hinzufügen
        </button>
        <FieldError
          errors={
            err?.fieldErrors.assignments ??
            Object.entries(err?.fieldErrors ?? {}).find(([k]) => k.startsWith('assignments.'))?.[1]
          }
        />
      </fieldset>
      {err && Object.keys(err.fieldErrors).length === 0 && <p className="error">{err.message}</p>}
      {notice && <p className="info">{notice}</p>}
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
