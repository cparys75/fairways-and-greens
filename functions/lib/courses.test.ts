import { describe, expect, it } from 'vitest';
import { isCourseId, normalizeCourse } from './courses';

const holes = (n: number) => Array.from({ length: n }, (_, i) => ({ par: 4, yardage: 350 + i, handicap: i + 1 }));

describe('normalizeCourse', () => {
  it('maps the GolfCourseAPI shape to CourseInfo', () => {
    const c = normalizeCourse({
      id: 12345,
      club_name: 'Oak Creek Golf Club',
      course_name: 'North',
      location: { city: 'Springfield', state: 'IL', country: 'United States' },
      tees: {
        male: [{ tee_name: 'Blue', course_rating: 71.2, slope_rating: 128, total_yards: 6500, holes: holes(18) }],
        female: [{ tee_name: 'Red', course_rating: 70.1, slope_rating: 120, holes: holes(18) }],
      },
    });
    expect(c).toMatchObject({ id: '12345', name: 'North', club: 'Oak Creek Golf Club', city: 'Springfield', state: 'IL' });
    expect(c.tees.map((t) => [t.name, t.gender, t.slope])).toEqual([
      ['Blue', 'male', 128],
      ['Red', 'female', 120],
    ]);
    expect(c.tees[0].holes[2]).toEqual({ par: 4, yardage: 352, handicap: 3 });
  });

  it('drops tees without usable hole data and tolerates missing fields', () => {
    const c = normalizeCourse({ id: 9, club_name: 'Muni', tees: { male: [{ tee_name: 'White', holes: [] }, { holes: holes(9) }] } });
    expect(c.name).toBe('Muni');
    expect(c.tees).toHaveLength(1);
    expect(c.tees[0].name).toBe('Tees');
    expect(normalizeCourse({ id: 1 }).tees).toEqual([]);
  });
});

describe('isCourseId', () => {
  it('accepts numeric and alphanumeric provider ids, and nothing that could change the URL', () => {
    expect(['12345', 'j7rt0gct', 'acj2-dwg_6'].every(isCourseId)).toBe(true);
    expect(['', '../search', 'a/b', 'a?x=1', 'x'.repeat(41)].some(isCourseId)).toBe(false);
  });
});
