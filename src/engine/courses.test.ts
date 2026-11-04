import { describe, expect, it } from 'vitest';
import { nineLabel, ninesFromCourse, rankWithinNine, type CourseInfo, type CourseTee } from './courses';

const tee = (name: string, gender: 'male' | 'female', hcps: number[], pars = Array(18).fill(4)): CourseTee => ({
  name,
  gender,
  holes: hcps.map((handicap, i) => ({ par: pars[i], yardage: 300 + i, handicap })),
});
// Typical card: odd indexes on the front, even on the back.
const MEN = [7, 3, 15, 1, 11, 17, 5, 13, 9, 8, 14, 2, 18, 6, 12, 4, 16, 10];
const WOMEN = [5, 1, 13, 3, 11, 17, 7, 15, 9, 10, 16, 4, 18, 2, 12, 6, 14, 8];
const course: CourseInfo = { id: '42', name: 'Oak Creek', club: 'Oak Creek GC', tees: [tee('Blue', 'male', MEN), tee('Red', 'female', WOMEN)] };

describe('rankWithinNine', () => {
  it('ranks 18-hole stroke indexes 1-9 within the nine', () => {
    expect(rankWithinNine(MEN.slice(0, 9))).toEqual([4, 2, 8, 1, 6, 9, 3, 7, 5]);
    expect(rankWithinNine(MEN.slice(9))).toEqual([4, 7, 1, 9, 3, 6, 2, 8, 5]);
  });
  it('puts holes with no index last, in hole order', () => {
    expect(rankWithinNine([null, 5, 0, 1, undefined, 3, 9, 7, 11])).toEqual([7, 3, 8, 1, 9, 2, 5, 4, 6]);
  });
});

describe('ninesFromCourse', () => {
  it('builds front and back nines with men and red-tee rankings', () => {
    const [front, back] = ninesFromCourse(course, course.tees[0], course.tees[1], ['front', 'back']);
    expect(front).toMatchObject({ id: 'oak-creek-front', name: 'Front Nine', course: 'Oak Creek GC – Oak Creek', tee: 'Blue' });
    expect(front.menHcp).toEqual([4, 2, 8, 1, 6, 9, 3, 7, 5]);
    expect(front.womenHcp).toEqual([3, 1, 7, 2, 6, 9, 4, 8, 5]);
    expect(front.yardage).toEqual([300, 301, 302, 303, 304, 305, 306, 307, 308]);
    expect(back.id).toBe('oak-creek-back');
    expect(back.firstHole).toBe(10);
    expect(front.firstHole).toBeUndefined();
    expect(back.yardage?.[0]).toBe(309);
    expect(nineLabel(front)).toBe('Oak Creek GC – Oak Creek – Front Nine');
  });

  it('avoids id clashes and falls back to men’s ranking without a matching red tee', () => {
    const [front] = ninesFromCourse(course, course.tees[0], null, ['front'], ['oak-creek-front']);
    expect(front.id).toBe('oak-creek-front-2');
    expect(front.womenHcp).toEqual(front.menHcp);
  });

  it('handles 9-hole courses', () => {
    const nine: CourseInfo = { id: '7', name: 'Short Pines', tees: [tee('White', 'male', [1, 2, 3, 4, 5, 6, 7, 8, 9])] };
    const out = ninesFromCourse(nine, nine.tees[0], null, ['front', 'back']);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Nine');
  });
});
