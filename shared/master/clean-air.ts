/**
 * The clean-air limits table (owner, 16 Nov 2026): one fixed table in the product, from EU GMP Annex 1 (2022), shown in
 * the master review and confirmed once by QA (docs/design.md). The count template of the sterile library (phase E)
 * checks environmental readings against it; a master or a step may set stricter limits, never looser ones.
 * - Total particles: Table 5 ("maximum permitted total particle concentration for monitoring"), particles per m³.
 * - Viable particles: Table 6 ("maximum action limits"), CFU. Grade A: no growth (any growth is investigated).
 * null: not set by Annex 1 (grade D in operation: the plant sets it by risk assessment; no glove prints in C and D).
 */
export const GRADES = ['A', 'B', 'C', 'D'] as const;
export type Grade = (typeof GRADES)[number];

export const CLEAN_AIR = {
  source: 'EU GMP Annex 1 (2022): Table 5 (total particles, monitoring) and Table 6 (viable particles, action limits)',
  particles: {
    A: { atRest: { '0.5': 3520, '5': 29 }, inOperation: { '0.5': 3520, '5': 29 } },
    B: { atRest: { '0.5': 3520, '5': 29 }, inOperation: { '0.5': 352000, '5': 2930 } },
    C: { atRest: { '0.5': 352000, '5': 2930 }, inOperation: { '0.5': 3520000, '5': 29300 } },
    D: { atRest: { '0.5': 3520000, '5': 29300 }, inOperation: { '0.5': null, '5': null } },
  },
  // Air sample CFU/m³, settle plate (90 mm) CFU per 4 hours, contact plate (55 mm) CFU per plate, glove print (5 fingers) CFU per glove.
  viable: {
    A: { air: 0, settlePlate: 0, contactPlate: 0, glovePrint: 0 },
    B: { air: 10, settlePlate: 5, contactPlate: 5, glovePrint: 5 },
    C: { air: 100, settlePlate: 50, contactPlate: 25, glovePrint: null },
    D: { air: 200, settlePlate: 100, contactPlate: 50, glovePrint: null },
  },
} as const satisfies {
  source: string;
  particles: Record<Grade, Record<'atRest' | 'inOperation', Record<'0.5' | '5', number | null>>>;
  viable: Record<Grade, Record<'air' | 'settlePlate' | 'contactPlate' | 'glovePrint', number | null>>;
};

export type ViableSample = keyof (typeof CLEAN_AIR)['viable']['A'];
export const VIABLE_WORDS: Record<ViableSample, string> = {
  air: 'Air sample, CFU/m³', settlePlate: 'Settle plate (90 mm), CFU per 4 hours', contactPlate: 'Contact plate (55 mm), CFU per plate', glovePrint: 'Glove print (5 fingers), CFU per glove',
};

/** The action limit for a viable count in a grade (0: no growth), or null where Annex 1 sets none. */
export const viableLimit = (grade: Grade, sample: ViableSample): number | null => CLEAN_AIR.viable[grade][sample];
/** The total particle limit per m³ for a grade, state and size, or null where Annex 1 leaves it to the plant. */
export const particleLimit = (grade: Grade, state: 'atRest' | 'inOperation', size: '0.5' | '5'): number | null => CLEAN_AIR.particles[grade][state][size];
