import {
  CAMPAIGN_STATUS_LABELS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  PERSPECTIVE_LABELS,
  PERSPECTIVES,
  type ItemType,
  type Perspective,
} from '@kb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconButton } from '../Icons';
import { ApiError, apiFetch } from '../lib/api';
import { formatDate } from './CampaignsPage';
import type { CampaignDetail, Item, Value } from './types';
import { FieldError, firstError } from './ValuesPage';

interface AssignmentLike {
  valueId: string;
  valueName: string;
  weight: number;
}
interface PoolEntry {
  id: string;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
  assignments: AssignmentLike[];
}

/** Detailseite einer Kampagne: Einstellungen, Pool, Abdeckung, Aktivierung (Anforderung 6). */
export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const campaign = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => apiFetch<CampaignDetail>(`/admin/campaigns/${id}`),
  });

  if (campaign.isLoading) return <p className="muted">Laden …</p>;
  if (campaign.error || !campaign.data) {
    return <p className="error">{firstError(campaign.error)}</p>;
  }
  const c = campaign.data;
  const draft = c.status === 'ENTWURF';

  return (
    <section>
      <p className="small">
        <Link to="/admin/kampagnen">← Alle Kampagnen</Link>
      </p>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Kampagne</span>
          <h1>{c.title}</h1>
          <p className="muted">
            {formatDate(c.startDate)} – {formatDate(c.endDate)} ·{' '}
            <span className={`badge campaign-${c.status}`}>{CAMPAIGN_STATUS_LABELS[c.status]}</span>
          </p>
        </div>
        {!draft && (
          <Link className="button" to={`/admin/kampagnen/${c.id}/auswertung`}>
            {c.status === 'AKTIV' ? 'Zwischenauswertung' : 'Auswertung'}
          </Link>
        )}
        {draft && <DeleteDraft campaign={c} />}
      </div>
      {draft ? <DraftEditor campaign={c} /> : <FrozenCampaign campaign={c} />}
    </section>
  );
}

function DeleteDraft({ campaign }: { campaign: CampaignDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/admin/campaigns/${campaign.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      navigate('/admin/kampagnen');
    },
  });
  return (
    <IconButton
      icon="delete"
      label="Entwurf löschen"
      onClick={() => {
        if (confirm(`Entwurf „${campaign.title}" wirklich löschen?`)) remove.mutate();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Entwurf: Einstellungen, Pool und Aktivierung
// ---------------------------------------------------------------------------

function DraftEditor({ campaign }: { campaign: CampaignDetail }) {
  const approved = useQuery({
    queryKey: ['items', '', 'FREIGEGEBEN'],
    queryFn: () => apiFetch<Item[]>('/admin/items?status=FREIGEGEBEN'),
  });
  const savedIds = useMemo(() => campaign.items.map((i) => i.id), [campaign.items]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(savedIds));
  useEffect(() => setSelected(new Set(savedIds)), [savedIds]);
  const dirty =
    selected.size !== savedIds.length || savedIds.some((savedId) => !selected.has(savedId));

  // Für die Abdeckung zählen die ausgewählten Fragen (auch noch nicht gespeicherte).
  const byId = new Map<string, PoolEntry>();
  for (const i of campaign.items) byId.set(i.id, i);
  for (const i of approved.data ?? []) byId.set(i.id, i);
  const selectedEntries = [...selected].map((sid) => byId.get(sid)).filter(Boolean) as PoolEntry[];

  return (
    <>
      <SettingsForm campaign={campaign} poolSize={selected.size} />
      <Coverage entries={selectedEntries} />
      <PoolPicker
        campaign={campaign}
        items={approved.data ?? []}
        loading={approved.isLoading}
        selected={selected}
        setSelected={setSelected}
        dirty={dirty}
      />
      <Activation campaign={campaign} dirty={dirty} />
    </>
  );
}

function SettingsForm({ campaign, poolSize }: { campaign: CampaignDetail; poolSize: number }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(campaign.title);
  const [startDate, setStartDate] = useState(campaign.startDate);
  const [endDate, setEndDate] = useState(campaign.endDate);
  const [perPerson, setPerPerson] = useState(campaign.itemsPerParticipant?.toString() ?? '');
  const [threshold, setThreshold] = useState(String(campaign.anonymityThreshold));
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<CampaignDetail>(`/admin/campaigns/${campaign.id}`, {
        method: 'PUT',
        body: {
          title,
          startDate,
          endDate,
          itemsPerParticipant: perPerson === '' ? null : Number(perPerson),
          anonymityThreshold: Number(threshold),
        },
      }),
    onSuccess: (c) => {
      qc.setQueryData(['campaign', campaign.id], c);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      setSaved(true);
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <form className="form panel" onSubmit={submit} onChange={() => setSaved(false)}>
      <h2>Einstellungen</h2>
      <label>
        Titel
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <FieldError errors={err?.fieldErrors.title} />
      </label>
      <div className="row">
        <label>
          Startdatum
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          Enddatum
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <FieldError errors={err?.fieldErrors.endDate} />
        </label>
      </div>
      <div className="row">
        <label>
          Fragen je Person
          <input
            type="number"
            min={1}
            max={Math.max(poolSize, 1)}
            value={perPerson}
            onChange={(e) => setPerPerson(e.target.value)}
          />
          <span className="hint">
            Jede Person erhält zufällig so viele Fragen aus dem Pool (1 bis {poolSize || '…'}).
            Empfehlung: 25–35, rund 10 Minuten.
          </span>
          <FieldError errors={err?.fieldErrors.itemsPerParticipant} />
        </label>
        <label>
          Anonymitätsschwelle
          <input
            type="number"
            min={3}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <span className="hint">
            Ergebnisse erscheinen erst ab so vielen Antworten (3–100, Vorgabe 5).
          </span>
          <FieldError errors={err?.fieldErrors.anonymityThreshold} />
        </label>
      </div>
      {err && Object.keys(err.fieldErrors).length === 0 && <p className="error">{err.message}</p>}
      {saved && <p className="info">Einstellungen gespeichert.</p>}
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          Einstellungen speichern
        </button>
      </div>
    </form>
  );
}

/** Wie viele Fragen des Pools je Wert und Perspektive vorkommen (Gewichtung > 0 %). */
function Coverage({ entries }: { entries: PoolEntry[] }) {
  const values = new Map<string, string>();
  for (const e of entries)
    for (const a of e.assignments) if (a.weight > 0) values.set(a.valueId, a.valueName);
  const rows = [...values].sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const count = (valueId: string, p: Perspective) =>
    entries.filter(
      (e) =>
        e.perspective === p && e.assignments.some((a) => a.valueId === valueId && a.weight > 0),
    ).length;

  return (
    <div className="panel coverage">
      <h2>Abdeckung des Pools</h2>
      <p className="muted small">
        Anzahl Fragen je Unternehmenswert und Perspektive. Rot markierte Nullen bedeuten, dass zu
        dieser Kombination keine Ergebnisse entstehen können.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Noch keine Fragen ausgewählt.</p>
      ) : (
        <table className="coverage-table">
          <thead>
            <tr>
              <th>Unternehmenswert</th>
              {PERSPECTIVES.map((p) => (
                <th key={p}>
                  <span className={`badge persp-${p}`}>{PERSPECTIVE_LABELS[p]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([vid, name]) => (
              <tr key={vid}>
                <th scope="row">{name}</th>
                {PERSPECTIVES.map((p) => {
                  const n = count(vid, p);
                  return (
                    <td key={p} className={n === 0 ? 'coverage-empty' : ''}>
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PoolPicker({
  campaign,
  items,
  loading,
  selected,
  setSelected,
  dirty,
}: {
  campaign: CampaignDetail;
  items: Item[];
  loading: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  dirty: boolean;
}) {
  const qc = useQueryClient();
  const values = useQuery({
    queryKey: ['values'],
    queryFn: () => apiFetch<Value[]>('/admin/values'),
  });
  const [valueId, setValueId] = useState('');
  const [perspective, setPerspective] = useState<Perspective | ''>('');
  const [itemType, setItemType] = useState<ItemType | ''>('');
  const shown = items.filter(
    (i) =>
      (!valueId || i.assignments.some((a) => a.valueId === valueId && a.weight > 0)) &&
      (!perspective || i.perspective === perspective) &&
      (!itemType || i.itemType === itemType),
  );
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));
  const save = useMutation({
    mutationFn: () =>
      apiFetch<CampaignDetail>(`/admin/campaigns/${campaign.id}/pool`, {
        method: 'PUT',
        body: { itemIds: [...selected] },
      }),
    onSuccess: (c) => {
      qc.setQueryData(['campaign', campaign.id], c);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const setShown = (on: boolean) => {
    const next = new Set(selected);
    for (const i of shown) {
      if (on) next.add(i.id);
      else next.delete(i.id);
    }
    setSelected(next);
  };

  return (
    <div className="panel">
      <h2>Fragen-Pool</h2>
      <p className="muted small">
        Nur freigegebene Fragen stehen zur Auswahl. Die Unternehmenswerte der Kampagne ergeben sich
        aus den gewählten Fragen.
      </p>
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
          Perspektive
          <select
            value={perspective}
            onChange={(e) => setPerspective(e.target.value as Perspective | '')}
          >
            <option value="">Alle</option>
            {PERSPECTIVES.map((p) => (
              <option key={p} value={p}>
                {PERSPECTIVE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Art
          <select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType | '')}>
            <option value="">Alle</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="bulk-row pool-bar">
        <label className="check">
          <input type="checkbox" checked={allShown} onChange={() => setShown(!allShown)} />
          Alle angezeigten auswählen
        </label>
        <span className="muted small">
          {shown.length} angezeigt · {selected.size} im Pool
          {dirty && ' · nicht gespeichert'}
        </span>
        <span className="spacer" />
        <button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Speichern …' : 'Pool speichern'}
        </button>
      </div>
      {save.error && <p className="error">{firstError(save.error)}</p>}
      {loading && <p className="muted">Laden …</p>}
      {!loading && items.length === 0 && (
        <p className="empty">
          Es gibt noch keine freigegebenen Fragen. Fragen werden unter „Fragen“ freigegeben.
        </p>
      )}
      <ul className="pool-list">
        {shown.map((i) => (
          <li key={i.id} className={selected.has(i.id) ? 'pool-selected' : ''}>
            <label className="check">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
              <span>
                <span className="pool-text">{i.text}</span>
                <span className="badges">
                  <span className={`badge persp-${i.perspective}`}>
                    {PERSPECTIVE_LABELS[i.perspective]}
                  </span>
                  <span className="badge">{ITEM_TYPE_LABELS[i.itemType]}</span>
                  <span className="muted small">
                    {i.assignments.map((a) => `${a.valueName} ${a.weight} %`).join(' · ')}
                  </span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Activation({ campaign, dirty }: { campaign: CampaignDetail; dirty: boolean }) {
  const qc = useQueryClient();
  const n = campaign.itemsPerParticipant;
  const checks = [
    { ok: campaign.poolSize > 0, text: 'Mindestens eine Frage im gespeicherten Pool' },
    {
      ok: n !== null && n >= 1 && n <= campaign.poolSize,
      text: `Fragen je Person festgelegt (1 bis ${campaign.poolSize || '…'})`,
    },
    { ok: !dirty, text: 'Alle Änderungen am Pool gespeichert' },
  ];
  const ready = checks.every((c) => c.ok);
  const activate = useMutation({
    mutationFn: () =>
      apiFetch<CampaignDetail>(`/admin/campaigns/${campaign.id}/activate`, { method: 'POST' }),
    onSuccess: (c) => {
      qc.setQueryData(['campaign', campaign.id], c);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });

  return (
    <div className="panel activation">
      <h2>Aktivieren</h2>
      <p className="muted small">
        Mit der Aktivierung werden Fragen, Gewichtungen und Einstellungen eingefroren. Spätere
        Änderungen an Fragen wirken erst in neuen Kampagnen.
      </p>
      <ul className="checklist">
        {checks.map((c) => (
          <li key={c.text} className={c.ok ? 'ok' : 'open'}>
            {c.text}
          </li>
        ))}
      </ul>
      {activate.error && <p className="error">{firstError(activate.error)}</p>}
      <button
        disabled={!ready || activate.isPending}
        onClick={() => {
          if (
            confirm(
              `Kampagne „${campaign.title}" mit ${campaign.poolSize} Fragen aktivieren? Pool und Einstellungen können danach nicht mehr geändert werden.`,
            )
          )
            activate.mutate();
        }}
      >
        Kampagne aktivieren
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aktiv oder abgeschlossen: eingefrorener Snapshot
// ---------------------------------------------------------------------------

function FrozenCampaign({ campaign }: { campaign: CampaignDetail }) {
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: () =>
      apiFetch<CampaignDetail>(`/admin/campaigns/${campaign.id}/close`, { method: 'POST' }),
    onSuccess: (c) => {
      qc.setQueryData(['campaign', campaign.id], c);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  return (
    <>
      <div className="panel">
        <h2>Übersicht</h2>
        <dl className="facts">
          <dt>Fragen im Pool</dt>
          <dd>{campaign.poolSize}</dd>
          <dt>Fragen je Person</dt>
          <dd>{campaign.itemsPerParticipant}</dd>
          <dt>Anonymitätsschwelle</dt>
          <dd>{campaign.anonymityThreshold} Antworten</dd>
          <dt>Aktiviert</dt>
          <dd>{campaign.activatedAt && new Date(campaign.activatedAt).toLocaleString('de-CH')}</dd>
          {campaign.closedAt && (
            <>
              <dt>Abgeschlossen</dt>
              <dd>{new Date(campaign.closedAt).toLocaleString('de-CH')}</dd>
            </>
          )}
        </dl>
        {campaign.status === 'AKTIV' && (
          <>
            <p className="info">
              Die Kampagne läuft. Verteilen Sie den Umfrage-Link unten, zum Beispiel per E-Mail oder
              im Intranet.
            </p>
            {close.error && <p className="error">{firstError(close.error)}</p>}
            <button
              className="dark"
              onClick={() => {
                if (
                  confirm(
                    `Kampagne „${campaign.title}" abschliessen? Danach werden keine Antworten mehr angenommen.`,
                  )
                )
                  close.mutate();
              }}
            >
              Kampagne abschliessen
            </button>
          </>
        )}
      </div>
      {campaign.status === 'AKTIV' && <SurveyLinkPanel campaignId={campaign.id} />}
      <Coverage entries={campaign.items.filter((i) => !i.deactivatedAt)} />
      <div className="panel">
        <h2>Eingefrorene Fragen</h2>
        <ul className="pool-list">
          {campaign.items.map((i) => (
            <li key={i.id}>
              <span className="pool-text">{i.text}</span>
              <span className="badges">
                <span className={`badge persp-${i.perspective}`}>
                  {PERSPECTIVE_LABELS[i.perspective]}
                </span>
                <span className="badge">{ITEM_TYPE_LABELS[i.itemType]}</span>
                <span className="muted small">
                  {i.assignments.map((a) => `${a.valueName} ${a.weight} %`).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

interface CampaignLink {
  token: string;
  createdAt: string;
}

/** Öffentlicher Umfrage-Link: erzeugen, kopieren, ersetzen (Anforderung 7.2, 7.14–7.16). */
function SurveyLinkPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const link = useQuery({
    queryKey: ['campaign-link', campaignId],
    queryFn: () => apiFetch<CampaignLink | null>(`/admin/campaigns/${campaignId}/link`),
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<CampaignLink>(`/admin/campaigns/${campaignId}/link`, { method: 'POST' }),
    onSuccess: (l) => {
      qc.setQueryData(['campaign-link', campaignId], l);
      setCopied(false);
    },
  });
  const url = link.data ? `${window.location.origin}/umfrage/${link.data.token}` : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="panel">
      <h2>Umfrage-Link</h2>
      {link.isLoading && <p className="muted">Laden …</p>}
      {url ? (
        <>
          <div className="link-row">
            <input
              className="link-field"
              value={url}
              readOnly
              aria-label="Umfrage-Link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={copy}>
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="muted small">
            Erzeugt am {new Date(link.data!.createdAt).toLocaleString('de-CH')}. Wer den Link hat,
            kann teilnehmen – verteilen Sie ihn nur an den vorgesehenen Personenkreis.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={create.isPending}
            onClick={() => {
              if (
                confirm(
                  'Neuen Link erzeugen? Der bisherige Link funktioniert danach nicht mehr. Bereits abgegebene Antworten bleiben erhalten, und wer schon teilgenommen hat, kann auch über den neuen Link nicht erneut teilnehmen.',
                )
              )
                create.mutate();
            }}
          >
            Neuen Link erzeugen
          </button>
        </>
      ) : (
        !link.isLoading && (
          <>
            <p className="muted">Für diese Kampagne gibt es noch keinen Umfrage-Link.</p>
            <button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
              Link erzeugen
            </button>
          </>
        )
      )}
      {create.error && <p className="error">{firstError(create.error)}</p>}
      <details className="table-alt">
        <summary>Wie zuverlässig ist der Schutz vor Mehrfachteilnahme?</summary>
        <p className="small">
          Der Browser merkt sich die Teilnahme (gespeicherter Code und Cookie). Das ist ein
          Best-Effort-Schutz: Mit einem privaten Fenster, einem anderen Browser oder Gerät oder nach
          dem Löschen der Browserdaten ist eine erneute Teilnahme möglich. Gespeichert wird nur ein
          anonymer Hash, nie Name, E-Mail- oder IP-Adresse.
        </p>
      </details>
    </div>
  );
}
