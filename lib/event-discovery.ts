import { z } from 'zod';
import { aiResearch, type AiUsage } from './ai';
import { eventNameKey, eventTiming } from './events';
import { INTERESTS, INTEREST_IDS, isInterestId, type InterestId } from './interests';
import { getBlob, putBlob, readDb, updateDb } from './store';
import type { CareerEvent, EventKind } from './types';

/**
 * Keeps the Events list current: once a week (and on demand) the model
 * searches the web for UAE career fairs and major expos, fills in dates for
 * recurring events once they're announced, and adds events that weren't on
 * the list. Your status, checklist, notes and hidden flag are never touched.
 */

const FoundEvent = z.object({
  matchesId: z.string().describe('The id of the known event this is the SAME edition of, or "" if it is new or a new edition'),
  name: z.string().describe('Official name including the year, e.g. "Ru\'ya Careers UAE 2027"'),
  kind: z.enum(['emirati-fair', 'career-fair', 'industry-expo']).describe('emirati-fair ONLY if the source says it is for UAE nationals'),
  interests: z
    .array(z.enum(['investing', 'finance', 'cyber', 'ai']))
    .describe('Fields it is especially relevant to: investing, finance (banking/fintech/insurance), cyber, ai. Empty for general fairs'),
  startDate: z.string().describe('YYYY-MM-DD, or "" if not announced'),
  endDate: z.string().describe('YYYY-MM-DD, or "" if not announced'),
  dateNote: z.string().describe('When dates are not announced: what is known, e.g. "Usually held in February". Else ""'),
  venue: z.string(),
  city: z.string(),
  url: z.string().describe('Official event website, or the best source page'),
  registerUrl: z.string().describe('Visitor registration page, or ""'),
  description: z.string().describe('One or two sentences: who it is for and why it matters to an Emirati job seeker'),
  exhibitors: z.array(z.string()).describe('Exhibiting employers named by a source, at most 30. Empty if none are listed'),
  sourceUrl: z.string().describe('The page the dates came from'),
});

export const Discovery = z.object({ events: z.array(FoundEvent) });
export type FoundEvent = z.infer<typeof FoundEvent>;

const SYSTEM = `You keep a list of UAE career events up to date for an Emirati job seeker.
Find: career fairs for UAE nationals (Ru'ya, Tawdheef, the National Career Exhibition, university and sector fairs such as aviation, industry, banking or health), general career fairs in the UAE, and the largest industry expos where hiring managers staff stands (ADIPEC, GITEX, Arab Health / WHX, Dubai Airshow and similar). When the job seeker has named fields of interest, also look hard for conferences, expos and recruitment events in those fields.
Only record what a source you found states. Never guess a date: if the organiser hasn't announced dates, leave them empty and say what's known in dateNote. Prefer the organiser's own site; WAM, The National, Khaleej Times and Gulf News are good second sources.
A new year's edition of a known event is a NEW event (leave matchesId empty); matchesId is only for the same edition, e.g. dates now announced for an event that had none.`;

const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined);
const url = (s: string) => (/^https?:\/\/\S+$/.test(s.trim()) ? s.trim() : undefined);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

const nameKey = eventNameKey;

export interface MergeResult {
  added: CareerEvent[];
  updated: Array<{ id: string; name: string; fields: string[] }>;
  skipped: number;
}

/**
 * Folds discovered events into the list. Pure, so it's tested without the
 * model: bad dates, past events and duplicates are dropped here whatever the
 * model returned.
 */
export function mergeDiscovered(existing: CareerEvent[], found: FoundEvent[], today: string, nowIso: string): MergeResult {
  const result: MergeResult = { added: [], updated: [], skipped: 0 };
  const horizon = new Date(Date.parse(today) + 550 * 86_400_000).toISOString().slice(0, 10);

  for (const f of found) {
    let start = iso(f.startDate);
    let end = iso(f.endDate) ?? start;
    if (start && end && end < start) [start, end] = [end, start];
    if (!start) end = undefined;
    // Over, or implausibly far out: a parsing accident or an old page.
    if ((end && end < today) || (start && start > horizon)) {
      result.skipped += 1;
      continue;
    }

    const byId = f.matchesId ? existing.find((e) => e.id === f.matchesId) : undefined;
    // The model may call a known event new; catch the same edition by name and dates.
    const byName = existing.find(
      (e) =>
        nameKey(e.name) === nameKey(f.name) &&
        (!e.startDate || !start || Math.abs(Date.parse(e.startDate) - Date.parse(start)) < 60 * 86_400_000)
    );
    const target = byId && eventTiming(byId, today).state !== 'ended' ? byId : byName && eventTiming(byName, today).state !== 'ended' ? byName : undefined;

    if (target) {
      const fields: string[] = [];
      const set = <K extends keyof CareerEvent>(key: K, value: CareerEvent[K] | undefined, when = true) => {
        if (value === undefined || value === '' || !when || target[key] === value) return;
        target[key] = value;
        fields.push(String(key));
      };
      // Dates: filled in once announced, or corrected if the organiser moved them.
      set('startDate', start);
      set('endDate', end);
      if (start && target.dateNote) {
        delete target.dateNote;
        fields.push('dateNote');
      }
      set('venue', f.venue, !target.venue);
      set('city', f.city, !target.city);
      set('url', url(f.url), !target.url);
      set('registerUrl', url(f.registerUrl), !target.registerUrl);
      set('description', f.description, !target.description);
      const newTags = (f.interests || []).filter((id) => isInterestId(id) && !(target.interests || []).includes(id));
      if (newTags.length) {
        target.interests = INTEREST_IDS.filter((id) => newTags.includes(id) || (target.interests || []).includes(id));
        fields.push('interests');
      }
      const have = new Set((target.exhibitors || []).map((x) => x.toLowerCase()));
      const extra = f.exhibitors.map((x) => x.trim()).filter((x) => x && !have.has(x.toLowerCase()));
      if (extra.length) {
        target.exhibitors = [...(target.exhibitors || []), ...extra].slice(0, 80);
        target.exhibitorsNote = `Updated ${today} from ${url(f.sourceUrl) ?? 'web search'}.`;
        fields.push('exhibitors');
      }
      if (fields.length) result.updated.push({ id: target.id, name: target.name, fields });
      continue;
    }

    if (!f.name.trim() || !url(f.url)) {
      result.skipped += 1;
      continue;
    }
    // Already added (this run or a previous one) under the same name and year.
    const id = `ev-ai-${slug(nameKey(f.name))}-${(start ?? today).slice(0, 4)}`;
    if (existing.some((e) => e.id === id) || result.added.some((e) => e.id === id)) {
      result.skipped += 1;
      continue;
    }
    const event: CareerEvent = {
      id,
      name: f.name.trim(),
      kind: f.kind as EventKind,
      interests: (f.interests || []).filter(isInterestId),
      startDate: start,
      endDate: end,
      dateNote: start ? undefined : f.dateNote || undefined,
      venue: f.venue,
      city: f.city,
      url: url(f.url),
      registerUrl: url(f.registerUrl),
      description: f.description || undefined,
      status: 'interested',
      exhibitors: f.exhibitors.slice(0, 80),
      exhibitorsNote: f.exhibitors.length ? `From ${url(f.sourceUrl) ?? 'web search'}, ${today}.` : undefined,
      discovered: true,
      sourceUrl: url(f.sourceUrl),
      createdAt: nowIso,
    };
    result.added.push(event);
  }
  return result;
}

export const DISCOVERY_META_KEY = 'meta:event-discovery';

export interface DiscoveryMeta {
  at: string;
  added: number;
  updated: number;
  searches: number;
  costUsd: number;
  error?: string;
}

export async function lastDiscovery(): Promise<DiscoveryMeta | null> {
  const raw = await getBlob(DISCOVERY_META_KEY);
  try {
    return raw ? (JSON.parse(raw) as DiscoveryMeta) : null;
  } catch {
    return null;
  }
}

/** Runs a discovery pass and saves the result. */
export async function discoverEvents(): Promise<MergeResult & { usage: AiUsage; searches: number }> {
  const db = await readDb();
  const today = new Date().toISOString().slice(0, 10);
  const known = db.events
    .map((e) => `- id=${e.id} | ${e.name} | ${e.startDate ? `${e.startDate} to ${e.endDate ?? e.startDate}` : e.dateNote || 'dates not announced'}`)
    .join('\n');

  const wanted: InterestId[] = db.profile.interests || [];
  const focus = wanted.length
    ? `\nThe job seeker's fields: ${wanted.map((id) => `${INTERESTS[id].label} (${INTERESTS[id].description})`).join('; ')}. Find the UAE conferences, expos and recruitment events for these fields too, e.g. cybersecurity (GISEC), AI (Dubai AI Week), finance and investing (Abu Dhabi Finance Week, Dubai FinTech Summit), and tag each event's fields.\n`
    : '';
  const prompt = `Today is ${today}. Find UAE career events and major hiring-relevant expos from now until about 12 months ahead.
${focus}
Events already on the list (check whether dates were announced for the undated ones, and whether the next edition of the ended ones is announced):
${known || '(none)'}

Record every event you can confirm, known or new.`;

  const { data, usage, searches } = await aiResearch({
    system: SYSTEM,
    prompt,
    schema: Discovery,
    recordTool: { name: 'record_events', description: 'Record the UAE career events and expos found, with sources.' },
    maxSearches: 8,
    effort: 'medium',
  });

  const nowIso = new Date().toISOString();
  const merged = await updateDb((live) => {
    const result = mergeDiscovered(live.events, data.events, today, nowIso);
    live.events.push(...result.added);
    return result;
  });

  await putBlob(
    DISCOVERY_META_KEY,
    JSON.stringify({ at: nowIso, added: merged.added.length, updated: merged.updated.length, searches, costUsd: usage.costUsd } satisfies DiscoveryMeta)
  );
  return { ...merged, usage, searches };
}

/** Weekly is plenty: organisers announce dates weeks or months ahead. */
export async function discoveryDue(days = 7): Promise<boolean> {
  const meta = await lastDiscovery();
  return !meta || Date.now() - Date.parse(meta.at) > days * 86_400_000;
}
