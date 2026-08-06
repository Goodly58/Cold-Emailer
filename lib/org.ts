/**
 * Which companies count as one organisation.
 *
 * Every sequencing invariant in this product — one live sequence, same-domain
 * spacing, cooldown, dormancy, reply conflicts — is enforced per organisation
 * rather than per company row, because "Emirates NBD" and "Emirates NBD
 * Capital" are two rows and one office. Two people there getting a cold email
 * the same morning is the failure.
 *
 * Grouping by normalised email domain covers most of it and needs no human
 * input, which is why `company.org_group_id` is assigned that way. It cannot
 * see a subsidiary that mails from its own domain, so `org_group_link` exists
 * for the manual case — and until this module existed, that table was written
 * by nothing and read by nothing, so the invariants silently did not hold
 * across it.
 *
 * One hop only. A link is a statement that two groups are the same employer,
 * and chaining those statements transitively across a whole conglomerate would
 * quietly stop the user writing to anyone at ADQ or Mubadala.
 */
import { execute, query } from './db/client';
import { nowIso } from './ids';

/**
 * A SQL fragment resolving one org group to its family, for use in an `IN`.
 *
 * Takes the group id as a parameter three times. Written as a fragment rather
 * than a join so the call sites stay readable — each of them is already a
 * three-table join before this is added.
 */
export const ORG_FAMILY_SQL = `(
  SELECT ?
  UNION SELECT parent_org_group_id FROM org_group_link WHERE child_org_group_id = ?
  UNION SELECT child_org_group_id  FROM org_group_link WHERE parent_org_group_id = ?
)`;

/** The three bindings `ORG_FAMILY_SQL` expects. */
export function orgFamilyArgs(orgGroupId: string): [string, string, string] {
  return [orgGroupId, orgGroupId, orgGroupId];
}

/**
 * A key per organisation family, for grouping in code rather than in SQL.
 *
 * `buildQueue` holds sets of org groups in memory and compares them; without
 * this, two linked groups compare as different and both get offered the same
 * morning. The key is the lowest id in the family, so it is stable however the
 * link was written round.
 */
export async function orgFamilyKeys(): Promise<Map<string, string>> {
  const links = await query<{ parent_org_group_id: string; child_org_group_id: string }>(
    'SELECT parent_org_group_id, child_org_group_id FROM org_group_link'
  );

  const key = new Map<string, string>();
  for (const link of links) {
    const family = [link.parent_org_group_id, link.child_org_group_id].sort()[0];
    // One hop, so a group already claimed by a family keeps that claim rather
    // than merging two families through a shared member.
    if (!key.has(link.parent_org_group_id)) key.set(link.parent_org_group_id, family);
    if (!key.has(link.child_org_group_id)) key.set(link.child_org_group_id, family);
  }
  return key;
}

/** Resolves one group to its family key, defaulting to itself. */
export function familyOf(orgGroupId: string, keys: Map<string, string>): string {
  return keys.get(orgGroupId) ?? orgGroupId;
}

/**
 * Records that two org groups are one employer.
 *
 * A founder action, not something the product can infer: nothing in a domain
 * name says that `endbcapital.com` belongs to Emirates NBD, and guessing it
 * from a name prefix would merge every company beginning with "Emirates".
 */
export async function linkOrgGroups(
  parentOrgGroupId: string,
  childOrgGroupId: string,
  note?: string
): Promise<boolean> {
  if (parentOrgGroupId === childOrgGroupId) return false;
  const changed = await execute(
    `INSERT INTO org_group_link (parent_org_group_id, child_org_group_id, note, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (parent_org_group_id, child_org_group_id) DO NOTHING`,
    [parentOrgGroupId, childOrgGroupId, note ?? null, nowIso()]
  );
  return changed > 0;
}

/** Undoes a link. Two companies wrongly merged means one of them is never written to. */
export async function unlinkOrgGroups(parentOrgGroupId: string, childOrgGroupId: string): Promise<boolean> {
  const changed = await execute(
    'DELETE FROM org_group_link WHERE parent_org_group_id = ? AND child_org_group_id = ?',
    [parentOrgGroupId, childOrgGroupId]
  );
  return changed > 0;
}

export interface LinkedFamily {
  parent: { id: string; domain: string; companies: string[] };
  child: { id: string; domain: string; companies: string[] };
  note: string | null;
}

/** Every link, with the company names on each side, for the founder to check. */
export async function listOrgLinks(): Promise<LinkedFamily[]> {
  const rows = await query<{
    parent_org_group_id: string;
    child_org_group_id: string;
    parent_domain: string;
    child_domain: string;
    note: string | null;
  }>(
    `SELECT l.parent_org_group_id, l.child_org_group_id, l.note,
            p.normalized_domain AS parent_domain, c.normalized_domain AS child_domain
       FROM org_group_link l
       JOIN org_group p ON p.id = l.parent_org_group_id
       JOIN org_group c ON c.id = l.child_org_group_id`
  );

  const out: LinkedFamily[] = [];
  for (const row of rows) {
    const [parentCompanies, childCompanies] = await Promise.all([
      query<{ name: string }>('SELECT name FROM company WHERE org_group_id = ?', [row.parent_org_group_id]),
      query<{ name: string }>('SELECT name FROM company WHERE org_group_id = ?', [row.child_org_group_id]),
    ]);
    out.push({
      parent: {
        id: row.parent_org_group_id,
        domain: row.parent_domain,
        companies: parentCompanies.map((c) => c.name),
      },
      child: {
        id: row.child_org_group_id,
        domain: row.child_domain,
        companies: childCompanies.map((c) => c.name),
      },
      note: row.note,
    });
  }
  return out;
}
