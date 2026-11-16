// The clean-air limits table (owner, 16 Nov 2026): EU GMP Annex 1 (2022) Tables 5 and 6, fixed in the product.
import { describe, expect, it } from 'vitest';
import { CLEAN_AIR, GRADES, particleLimit, viableLimit } from '../shared/master/clean-air.js';

describe('the clean-air limits table (Annex 1)', () => {
  it('clean-air table: Table 6: grade A is no growth; B, C and D have their action limits; no glove prints in C and D', () => {
    expect(GRADES.map((g) => viableLimit(g, 'air'))).toEqual([0, 10, 100, 200]);
    expect(GRADES.map((g) => viableLimit(g, 'settlePlate'))).toEqual([0, 5, 50, 100]);
    expect(GRADES.map((g) => viableLimit(g, 'contactPlate'))).toEqual([0, 5, 25, 50]);
    expect(GRADES.map((g) => viableLimit(g, 'glovePrint'))).toEqual([0, 5, null, null]);
  });

  it('clean-air table: Table 5: particles per m³ at rest and in operation; grade D in operation is the plant\'s', () => {
    expect(GRADES.map((g) => [particleLimit(g, 'atRest', '0.5'), particleLimit(g, 'atRest', '5')])).toEqual([[3520, 29], [3520, 29], [352000, 2930], [3520000, 29300]]);
    expect(GRADES.map((g) => [particleLimit(g, 'inOperation', '0.5'), particleLimit(g, 'inOperation', '5')])).toEqual([[3520, 29], [352000, 2930], [3520000, 29300], [null, null]]);
    // Each grade is at least as clean as the next.
    for (let i = 1; i < GRADES.length; i++) expect(CLEAN_AIR.viable[GRADES[i]!].air!).toBeGreaterThan(CLEAN_AIR.viable[GRADES[i - 1]!].air!);
  });
});
