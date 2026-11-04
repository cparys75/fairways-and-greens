import type { Nine } from './types';

/** A course as returned by a course-data provider, normalized (see functions/lib/courses.ts). */
export interface CourseHole {
  par: number;
  yardage?: number | null;
  /** 18-hole stroke index, 1 = hardest. */
  handicap?: number | null;
}

export interface CourseTee {
  name: string;
  gender: 'male' | 'female';
  rating?: number | null;
  slope?: number | null;
  totalYards?: number | null;
  holes: CourseHole[];
}

export interface CourseSummary {
  id: string;
  name: string;
  club?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface CourseInfo extends CourseSummary {
  tees: CourseTee[];
}

export type Half = 'front' | 'back';

export function courseLabel(c: CourseSummary): string {
  return c.club && c.club !== c.name && !c.name.includes(c.club) ? `${c.club} – ${c.name}` : c.name;
}

/** Hole number as printed on the card (back nines show 10-18). */
export function holeNumber(n: Pick<Nine, 'firstHole'>, index: number): number {
  return (n.firstHole ?? 1) + index;
}

export function nineLabel(n: Pick<Nine, 'name' | 'course'>): string {
  return n.course && !n.name.includes(n.course) ? `${n.course} – ${n.name}` : n.name;
}

/**
 * Turn 18-hole stroke indexes for one nine into the 1-9 ranking the league uses
 * (e.g. front-nine indexes 1,3,5…17 become 1,2,3…9). Holes without an index rank last, in hole order.
 */
export function rankWithinNine(handicaps: (number | null | undefined)[]): number[] {
  const order = handicaps
    .map((h, i) => ({ i, h: h && h > 0 ? h : Infinity }))
    .sort((a, b) => a.h - b.h || a.i - b.i);
  const rank = Array<number>(handicaps.length);
  order.forEach((o, r) => (rank[o.i] = r + 1));
  return rank;
}

export function halvesOf(tee: CourseTee): Half[] {
  return tee.holes.length >= 18 ? ['front', 'back'] : tee.holes.length >= 9 ? ['front'] : [];
}

/** Build league nines from a course's tees. Pars and yardage come from the men's tee. */
export function ninesFromCourse(
  course: CourseInfo,
  menTee: CourseTee,
  womenTee: CourseTee | null,
  halves: Half[],
  existingIds: string[] = [],
): Nine[] {
  const courseName = courseLabel(course);
  const taken = new Set(existingIds);
  const base = slug(course.name) || 'course';
  return halves
    .filter((h) => halvesOf(menTee).includes(h))
    .map((half) => {
      const start = half === 'front' ? 0 : 9;
      const men = menTee.holes.slice(start, start + 9);
      const women = womenTee?.holes.length === menTee.holes.length ? womenTee.holes.slice(start, start + 9) : null;
      const menHcp = rankWithinNine(men.map((h) => h.handicap));
      let id = `${base}-${half}`;
      for (let n = 2; taken.has(id); n++) id = `${base}-${half}-${n}`;
      taken.add(id);
      const yardage = men.map((h) => h.yardage ?? 0);
      return {
        id,
        name: menTee.holes.length >= 18 ? (half === 'front' ? 'Front Nine' : 'Back Nine') : 'Nine',
        course: courseName,
        tee: menTee.name,
        par: men.map((h) => h.par),
        menHcp,
        womenHcp: women ? rankWithinNine(women.map((h) => h.handicap)) : menHcp,
        ...(yardage.some(Boolean) ? { yardage } : {}),
        ...(start ? { firstHole: start + 1 } : {}),
        source: `GolfCourseAPI ${course.id}`,
      };
    });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}
