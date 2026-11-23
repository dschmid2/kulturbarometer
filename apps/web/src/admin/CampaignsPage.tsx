import { CAMPAIGN_STATUS_LABELS } from '@kb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import type { CampaignDetail, CampaignSummary } from './types';
import { FieldError } from './ValuesPage';

export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('de-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** Kampagnen der aktiven Unternehmung (Anforderung 6). */
export function CampaignsPage() {
  const [creating, setCreating] = useState(false);
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch<CampaignSummary[]>('/admin/campaigns'),
  });

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Erhebung</span>
          <h1>Kampagnen</h1>
          <p className="muted">
            Eine Kampagne ist ein Erhebungsfenster mit einem Set freigegebener Fragen. Mit der
            Aktivierung wird der Fragen-Pool eingefroren, damit die Ergebnisse vergleichbar bleiben.
          </p>
        </div>
        <button onClick={() => setCreating(true)}>Neue Kampagne</button>
      </div>
      {creating && <NewCampaignForm onDone={() => setCreating(false)} />}
      {campaigns.isLoading && <p className="muted">Laden …</p>}
      {campaigns.data?.length === 0 && !creating && (
        <p className="empty">Noch keine Kampagne angelegt.</p>
      )}
      <div className="cards">
        {campaigns.data?.map((c) => (
          <Link key={c.id} to={`/admin/kampagnen/${c.id}`} className="card card-link">
            <div className="card-header">
              <div>
                <h2>{c.title}</h2>
                <p className="muted small">
                  {formatDate(c.startDate)} – {formatDate(c.endDate)}
                </p>
              </div>
              <span className={`badge campaign-${c.status}`}>
                {CAMPAIGN_STATUS_LABELS[c.status]}
              </span>
            </div>
            <p className="muted small">
              {c.poolSize} {c.poolSize === 1 ? 'Frage' : 'Fragen'} im Pool
              {c.itemsPerParticipant ? ` · ${c.itemsPerParticipant} je Person` : ''} ·
              Anonymitätsschwelle {c.anonymityThreshold}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function NewCampaignForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<CampaignDetail>('/admin/campaigns', {
        method: 'POST',
        body: { title, startDate, endDate },
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      onDone();
      navigate(`/admin/kampagnen/${c.id}`);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form className="form panel" onSubmit={submit}>
      <h2>Neue Kampagne</h2>
      <label>
        Titel (1–200 Zeichen)
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <FieldError errors={err?.fieldErrors.title} />
      </label>
      <div className="row">
        <label>
          Startdatum
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <FieldError errors={err?.fieldErrors.startDate} />
        </label>
        <label>
          Enddatum
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <FieldError errors={err?.fieldErrors.endDate} />
        </label>
      </div>
      {err && Object.keys(err.fieldErrors).length === 0 && <p className="error">{err.message}</p>}
      <div className="actions">
        <button type="submit" disabled={create.isPending}>
          Anlegen
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
