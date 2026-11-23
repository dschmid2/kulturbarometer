import type { Role } from '@kb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setActiveOrganizationId } from '../lib/api';
import type { Me } from './types';

interface Workspace {
  me: Me;
  /** Aktive Unternehmung oder `null`, wenn der Benutzer keiner zugeordnet ist. */
  org: Me['organizations'][number] | null;
  selectOrg: (id: string) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const WorkspaceContext = createContext<Workspace | null>(null);
const STORAGE_KEY = 'kb-active-organization';

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Hält die aktive Unternehmung (Anforderung 12) und stellt Rollenprüfungen bereit. */
export function WorkspaceProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const initial = () => {
    const stored = readStoredOrg();
    return me.organizations.find((o) => o.id === stored)?.id ?? me.organizations[0]?.id ?? null;
  };
  const [orgId, setOrgId] = useState<string | null>(initial);
  const org = me.organizations.find((o) => o.id === orgId) ?? null;

  // Synchron setzen, damit schon die ersten Abfragen der Seite den richtigen Header tragen.
  setActiveOrganizationId(org?.id ?? null);

  useEffect(() => {
    if (!org && me.organizations[0]) setOrgId(me.organizations[0].id);
  }, [org, me.organizations]);

  const selectOrg = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* Auswahl gilt dann nur für diese Sitzung */
    }
    setActiveOrganizationId(id);
    // Daten der bisherigen Unternehmung verwerfen, damit nichts vermischt wird.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    setOrgId(id);
  };

  const hasRole = (...roles: Role[]) => !!org && roles.some((r) => org.roles.includes(r));

  return (
    <WorkspaceContext.Provider value={{ me, org, selectOrg, hasRole }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace außerhalb des WorkspaceProvider');
  return ctx;
}
