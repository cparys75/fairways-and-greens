/**
 * Course lookup via GolfCourseAPI (https://golfcourseapi.com). The API key stays on the server
 * (secret GOLF_COURSE_API_KEY); the browser only sees normalized CourseInfo objects.
 */
import type { CourseHole, CourseInfo, CourseSummary, CourseTee } from '../../src/engine';

const BASE = 'https://api.golfcourseapi.com/v1';
const DAY = 60 * 60 * 24;

export interface CourseEnv {
  GOLF_COURSE_API_KEY?: string;
}

export class CourseLookupError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export async function searchCourses(env: CourseEnv, query: string): Promise<CourseSummary[]> {
  const json = await call(env, `/search?search_query=${encodeURIComponent(query)}`, DAY);
  const list = (json as { courses?: unknown[] }).courses ?? [];
  return list.map((c) => summarize(c as RawCourse));
}

export async function getCourse(env: CourseEnv, id: string): Promise<CourseInfo> {
  if (!isCourseId(id)) throw new CourseLookupError('Invalid course id', 400);
  const json = (await call(env, `/courses/${id}`, 7 * DAY)) as { course?: RawCourse } & RawCourse;
  return normalizeCourse(json.course ?? json);
}

/** Provider ids: numbers in older data, short strings like "j7rt0gct" now. Safe to put in a URL path. */
export function isCourseId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(id);
}

async function call(env: CourseEnv, path: string, ttl: number): Promise<unknown> {
  if (!env.GOLF_COURSE_API_KEY) {
    throw new CourseLookupError('Course lookup is not set up. Add the GOLF_COURSE_API_KEY secret (see README).', 501);
  }
  const url = BASE + path;
  // Cache successful lookups at the edge so repeat searches don't use the provider's daily quota.
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(url);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit.json();

  const request = (scheme: string) =>
    fetch(url, { headers: { Authorization: `${scheme} ${env.GOLF_COURSE_API_KEY}`, Accept: 'application/json' } }).catch(() => {
      throw new CourseLookupError("Couldn't reach the course-data service. Try again in a minute, or enter the scorecard by hand.");
    });
  // Keys are issued with "Authorization: Bearer <key>"; older docs used "Key <key>", so try that if rejected.
  let res = await request('Bearer');
  if (res.status === 401) res = await request('Key');
  if (res.status === 401 || res.status === 403) throw new CourseLookupError('The course-data API key was rejected. Check GOLF_COURSE_API_KEY.');
  if (res.status === 404) throw new CourseLookupError('Course not found', 404);
  if (res.status === 429) throw new CourseLookupError('Course lookup limit reached for today. Try again tomorrow, or enter the scorecard by hand.', 429);
  if (!res.ok) throw new CourseLookupError(`Course lookup failed (${res.status})`);
  const json = await res.json();
  await cache
    ?.put(key, new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } }))
    .catch(() => undefined);
  return json;
}

interface RawHole {
  par?: number;
  yardage?: number;
  handicap?: number;
}
interface RawTee {
  tee_name?: string;
  course_rating?: number;
  slope_rating?: number;
  total_yards?: number;
  holes?: RawHole[];
}
interface RawCourse {
  id?: number | string;
  club_name?: string;
  course_name?: string;
  location?: { city?: string; state?: string; country?: string };
  tees?: { male?: RawTee[]; female?: RawTee[] };
}

function summarize(c: RawCourse): CourseSummary {
  const club = c.club_name?.trim() || undefined;
  return {
    id: String(c.id ?? ''),
    name: c.course_name?.trim() || club || 'Unnamed course',
    club,
    city: c.location?.city || undefined,
    state: c.location?.state || undefined,
    country: c.location?.country || undefined,
  };
}

export function normalizeCourse(c: RawCourse): CourseInfo {
  const tees: CourseTee[] = (['male', 'female'] as const).flatMap((gender) =>
    (c.tees?.[gender] ?? [])
      .map((t) => ({
        name: t.tee_name?.trim() || 'Tees',
        gender,
        rating: t.course_rating ?? null,
        slope: t.slope_rating ?? null,
        totalYards: t.total_yards ?? null,
        holes: (t.holes ?? []).map((h): CourseHole => ({ par: Number(h.par) || 0, yardage: h.yardage ?? null, handicap: h.handicap ?? null })),
      }))
      // A tee is only usable if every hole has a par.
      .filter((t) => t.holes.length >= 9 && t.holes.every((h) => h.par >= 3 && h.par <= 6)),
  );
  return { ...summarize(c), tees };
}
