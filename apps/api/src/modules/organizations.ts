/** Unternehmungen, Mitgliedschaften und Rollen (Anforderung 12). */
import {
  memberInputSchema,
  memberRolesSchema,
  organizationInputSchema,
  ROLES,
  type Role,
} from '@kb/shared';
import { Router } from 'express';
import { orgId, requirePlatformAdmin, requireRole, type Identity } from '../auth/guard.js';
import type { UserDirectory } from '../auth/provider.js';
import type { Sql } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';

// ---------------------------------------------------------------------------
// Wer bin ich?
// ---------------------------------------------------------------------------

export interface MeDto {
  userId: string;
  email: string | null;
  platformAdmin: boolean;
  organizations: { id: string; name: string; roles: Role[] }[];
}

/** Eigene Identität mit allen Unternehmungen und Rollen; Plattform-Admins sehen alle Unternehmungen. */
export async function getMe(sql: Sql, user: Identity): Promise<MeDto> {
  const organizations = user.platformAdmin
    ? (
        await sql<{ id: string; name: string }[]>`select id, name from organization order by name`
      ).map((o) => ({ ...o, roles: [...ROLES] as Role[] }))
    : await sql<{ id: string; name: string; roles: Role[] }[]>`
        select o.id, o.name, m.roles
        from organization_member m join organization o on o.id = m.organization_id
        where m.user_id = ${user.userId}
        order by o.name`;
  return {
    userId: user.userId,
    email: user.email,
    platformAdmin: user.platformAdmin,
    organizations,
  };
}

// ---------------------------------------------------------------------------
// Unternehmungen (nur Plattform-Administratoren)
// ---------------------------------------------------------------------------

export interface OrganizationDto {
  id: string;
  name: string;
  memberCount: number;
}

function duplicateOrg(err: unknown): AppError | null {
  const e = err as { code?: string; constraint_name?: string };
  if (e.code === '23505' && e.constraint_name === 'organization_name_unique') {
    return new AppError(
      409,
      'DUPLICATE_NAME',
      'Eine Unternehmung mit diesem Namen gibt es bereits.',
      {
        name: ['Eine Unternehmung mit diesem Namen gibt es bereits.'],
      },
    );
  }
  return null;
}

export async function listOrganizations(sql: Sql): Promise<OrganizationDto[]> {
  return sql<OrganizationDto[]>`
    select o.id, o.name, count(m.user_id)::int as "memberCount"
    from organization o left join organization_member m on m.organization_id = o.id
    group by o.id order by o.name`;
}

export async function createOrganization(sql: Sql, body: unknown): Promise<OrganizationDto> {
  const { name } = organizationInputSchema.parse(body);
  try {
    const [row] = await sql<
      { id: string }[]
    >`insert into organization (name) values (${name.trim()}) returning id`;
    return { id: row!.id, name: name.trim(), memberCount: 0 };
  } catch (err) {
    throw duplicateOrg(err) ?? err;
  }
}

export async function renameOrganization(
  sql: Sql,
  id: string,
  body: unknown,
): Promise<OrganizationDto> {
  const { name } = organizationInputSchema.parse(body);
  try {
    const rows =
      await sql`update organization set name = ${name.trim()} where id = ${id} returning id`;
    if (rows.length === 0) throw notFound('Die Unternehmung');
  } catch (err) {
    throw duplicateOrg(err) ?? err;
  }
  return (await listOrganizations(sql)).find((o) => o.id === id)!;
}

// ---------------------------------------------------------------------------
// Benutzer einer Unternehmung (Rolle Benutzer-Administration)
// ---------------------------------------------------------------------------

export interface MemberDto {
  userId: string;
  email: string;
  roles: Role[];
}

export async function listMembers(sql: Sql, org: string): Promise<MemberDto[]> {
  return sql<MemberDto[]>`
    select user_id as "userId", email, roles from organization_member
    where organization_id = ${org} order by lower(email)`;
}

/**
 * Ordnet einen Benutzer per E-Mail der Unternehmung zu. Existiert noch kein Konto, wird es
 * eingeladen, sofern Einladungen konfiguriert sind.
 */
export async function addMember(
  sql: Sql,
  directory: UserDirectory,
  org: string,
  body: unknown,
  inviteRedirect?: string,
): Promise<MemberDto & { invited: boolean }> {
  const { email, roles } = memberInputSchema.parse(body);
  let user = await directory.findByEmail(email);
  let invited = false;
  if (!user) {
    user = await directory.invite(email, inviteRedirect);
    if (!user) {
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'Zu dieser E-Mail-Adresse gibt es noch kein Konto. Legen Sie es im Supabase-Dashboard an oder hinterlegen Sie SUPABASE_SECRET_KEY, damit Einladungen per E-Mail möglich sind.',
        { email: ['Zu dieser E-Mail-Adresse gibt es noch kein Konto.'] },
      );
    }
    invited = true;
  }
  const [existing] = await sql`
    select 1 from organization_member where organization_id = ${org} and user_id = ${user.id}`;
  if (existing) {
    throw new AppError(
      409,
      'ALREADY_MEMBER',
      'Dieser Benutzer ist der Unternehmung bereits zugeordnet.',
      {
        email: ['Dieser Benutzer ist der Unternehmung bereits zugeordnet.'],
      },
    );
  }
  await sql`
    insert into organization_member (organization_id, user_id, email, roles)
    values (${org}, ${user.id}, ${user.email}, ${roles})`;
  return { userId: user.id, email: user.email, roles, invited };
}

/** Prüft, dass nach einer Änderung noch mindestens ein Mitglied die Benutzer-Administration hat. */
async function assertAdminRemains(
  sql: Sql,
  org: string,
  changedUserId: string,
  newRoles: Role[] | null,
) {
  const members = await listMembers(sql, org);
  if (!members.some((m) => m.roles.includes('ADMIN'))) return;
  const remaining = members.filter((m) =>
    m.userId === changedUserId ? newRoles?.includes('ADMIN') : m.roles.includes('ADMIN'),
  );
  if (remaining.length === 0) {
    throw new AppError(
      409,
      'LAST_ADMIN',
      'Mindestens ein Benutzer muss die Rolle „Benutzer-Administration" behalten.',
    );
  }
}

export async function updateMemberRoles(
  sql: Sql,
  org: string,
  userId: string,
  body: unknown,
): Promise<MemberDto> {
  const { roles } = memberRolesSchema.parse(body);
  await assertAdminRemains(sql, org, userId, roles);
  const [row] = await sql<MemberDto[]>`
    update organization_member set roles = ${roles}
    where organization_id = ${org} and user_id = ${userId}
    returning user_id as "userId", email, roles`;
  if (!row) throw notFound('Der Benutzer');
  return row;
}

export async function removeMember(sql: Sql, org: string, userId: string): Promise<void> {
  await assertAdminRemains(sql, org, userId, null);
  const rows = await sql`
    delete from organization_member where organization_id = ${org} and user_id = ${userId} returning user_id`;
  if (rows.length === 0) throw notFound('Der Benutzer');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Routen ohne Unternehmungs-Kontext: eigene Identität und Verwaltung der Unternehmungen. */
export function accountRouter(sql: () => Sql): Router {
  const r = Router();
  r.get('/me', async (req, res) => {
    res.json(await getMe(sql(), req.user!));
  });
  r.get('/organizations', requirePlatformAdmin, async (_req, res) => {
    res.json(await listOrganizations(sql()));
  });
  r.post('/organizations', requirePlatformAdmin, async (req, res) => {
    res.status(201).json(await createOrganization(sql(), req.body));
  });
  r.put('/organizations/:id', requirePlatformAdmin, async (req, res) => {
    res.json(await renameOrganization(sql(), String(req.params.id), req.body));
  });
  return r;
}

/** Benutzer der aktiven Unternehmung (nach `orgContext`). */
export function membersRouter(sql: () => Sql, directory: () => UserDirectory): Router {
  const r = Router();
  const admin = requireRole('ADMIN');
  r.get('/members', admin, async (req, res) => {
    res.json(await listMembers(sql(), orgId(req)));
  });
  r.post('/members', admin, async (req, res) => {
    const origin = req.header('origin');
    res
      .status(201)
      .json(
        await addMember(
          sql(),
          directory(),
          orgId(req),
          req.body,
          origin ? `${origin}/admin` : undefined,
        ),
      );
  });
  r.put('/members/:userId', admin, async (req, res) => {
    res.json(await updateMemberRoles(sql(), orgId(req), String(req.params.userId), req.body));
  });
  r.delete('/members/:userId', admin, async (req, res) => {
    await removeMember(sql(), orgId(req), String(req.params.userId));
    res.status(204).end();
  });
  return r;
}
