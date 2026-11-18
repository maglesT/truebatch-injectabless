/**
 * A master version is ONE JSON document: the header, the formula, and the stages in order with their steps in order.
 * This schema checks only its shape; whether it makes a good master is for checks.ts. A draft may be incomplete.
 */
import { z } from 'zod';

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'a plain decimal, e.g. "250.0"');
export const keySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lower-case letters, digits and -');
const text = (max = 200) => z.string().trim().max(max);

export const limitSchema = z.object({
  low: z.string().optional(), high: z.string().optional(), unit: z.string(),
  lowStrict: z.boolean().optional(), highStrict: z.boolean().optional(),
  alertLow: z.string().optional(), alertHigh: z.string().optional(),
}).strict();

// A step setting: a value as written ("0.5", "250.0 mg"), a limit, or a reference to an earlier step's field or
// calculation ("stage/step/name"), to a formula line (its batch quantity, adjusted when asked) or to the header.
// Header values (shared/engine/values.ts headerValue): the batch as written, its volume (L), its mass (kg; by the
// density), the expected units (the volume ÷ the fill target, or the units of a batch in units), the nominal fill and
// the fill target (fill + excess, mL), and the density.
export const HEADER_VALUES = ['batchSize', 'batchVolume', 'batchMass', 'units', 'fillVolume', 'fillTarget', 'density'] as const;
// The header values per vial or container: the only ones a block setting with notBatch 'tablet' takes (the others are
// per batch, or the density).
export const PER_UNIT_HEADERS: readonly (typeof HEADER_VALUES)[number][] = ['fillVolume', 'fillTarget'];
export const settingValueSchema = z.union([
  text(),
  limitSchema,
  z.object({ ref: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-zA-Z0-9]+$/, 'stage/step/name') }).strict(),
  z.object({ formula: keySchema, adjusted: z.boolean().optional() }).strict(),
  z.object({ header: z.enum(HEADER_VALUES) }).strict(),
]);

const flowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  // Rounds of the same step until the stop check passes, at most maxRounds (then a deviation note is needed).
  z.object({ kind: z.literal('repeat-until'), maxRounds: z.number().int().min(1).max(500).optional(), stop: z.string().optional() }).strict(),
  z.object({ kind: z.literal('optional-with-reason') }).strict(),
  z.object({ kind: z.literal('qa-hold') }).strict(),
]);

export const stepSchema = z.object({
  key: keySchema,
  block: z.object({ id: z.string(), version: z.number().int().min(1) }).strict(),
  // The name people read (e.g. "Punch and die check — after compression"); without it, the block's name and material.
  name: text(120).optional(),
  instruction: text(4000).optional(),
  settings: z.record(settingValueSchema).default({}),
  // The performer always signs; a second person checks when true.
  checker: z.boolean(),
  // The next step waits for the check (otherwise it opens when this step is done).
  waitForCheck: z.boolean().default(false),
  critical: z.boolean().default(false),
  minMinutes: z.number().int().positive().max(10_000).optional(),
  everyMinutes: z.number().int().positive().max(10_000).optional(),
  // F6 with a changing interval: after `afterMinutes` from the first round, a round every `everyMinutes` (F0030).
  everyMinutesLater: z.object({ afterMinutes: z.number().int().positive().max(10_000), everyMinutes: z.number().int().positive().max(10_000) }).strict().optional(),
  // F4 by a rule: the step is done only when a header value is within the limit (F0040: the bag premix only for a
  // batch of at most 50 kg); otherwise it is not applicable, with no operator choice.
  onlyIf: z.object({ header: z.enum(HEADER_VALUES), limit: limitSchema }).strict().optional(),
  // Order-critical: this step must come after the step with this key in the same stage (F0318: the drug after the PVP).
  orderAfter: keySchema.optional(),
  flow: flowSchema.default({ kind: 'none' }),
  // Only trained people sign (owner, 17 Nov 2026): the skill Recruitment publishes (training_v1) that the performer and
  // the checker must hold, picked from Recruitment's list (typed only while the link is off). None: anyone may sign.
  training: z.object({ code: text(60).min(1), title: text(200).optional() }).strict().optional(),
}).strict();

export const stageSchema = z.object({
  key: keySchema,
  name: text().min(1),
  kind: z.enum(['normal', 'preparation', 'sub-batch']),
  // TI-23, TI-28: an aseptic stage (set-up, filling and closing in grade A): its steps are only for aseptic operators.
  aseptic: z.boolean().optional(),
  count: z.number().int().min(2).max(50).optional(),
  roomTypes: z.array(text()).max(20).default([]),
  machineTypes: z.array(text()).max(50).default([]),
  role: text().default(''),
  produces: z.object({ name: text().min(1), holdHours: z.number().positive().max(100_000).optional() }).strict().optional(),
  // Stages whose intermediate this stage uses (preparations must be closed first; their hold time ends here).
  uses: z.array(keySchema).max(20).default([]),
  // Engine change 3: results that come days later (EM plates, BIs, bioburden). A preparation stage that starts after
  // this earlier step ("stage/step") is done, runs beside the stages after it and must close before production signs.
  startsAfter: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, 'stage/step').optional(),
  steps: z.array(stepSchema).max(200),
}).strict();

const form = z.object({
  name: text().min(1), mw: decimal, moleculesPerUnit: z.number().int().min(1).optional(), hydrateOrSolvate: z.boolean().optional(),
  // The ion's charge, for a label claim in mEq (F0393).
  charge: z.number().int().min(1).max(4).optional(),
}).strict();

export const lineSchema = z.object({
  key: keySchema,
  materialItemId: z.string().min(1).max(100),
  code: text(),
  name: text(),
  // mg per mL of the batch (a batch in L or kg), or mg per unit (a batch in units: a dry powder fill). A solvent made
  // up to volume (water for injections "q.s.") has none: it is whatever makes the volume.
  mg: decimal.optional(),
  // solvent: the vehicle the batch is made up to volume with (water for injections), or a solvent removed in processing.
  role: z.enum(['api', 'excipient', 'solvent']),
  // The API's label claim per mL or per unit ("50 mg", "10 mEq"), on the basis the label-basis answer gives; checked,
  // never used.
  labelClaim: text(40).optional(),
  // A batch quantity as written in the source ("12.000 kg"); only checked against mg per mL × batch volume (T8).
  batchQuantity: text(40).optional(),
  // Settings of the adjustment templates, applied in this order: T11 salt factor, T9 potency or T18 content, T16
  // overage; or, for a filler, T10 compensation of the named lines.
  adjust: z.object({
    // `factor`: the salt factor as written in the formula; only checked against the molecular weights, never used.
    salt: z.object({ from: form, to: form, factor: decimal.optional() }).strict().optional(),
    potency: z.object({
      basis: z.enum(['as is', 'anhydrous', 'dried', 'ignited', 'anhydrous and solvent-free']),
      standardIs: z.enum(['anhydrous', 'hydrate or solvate']).optional(),
      assayExpressedAs: z.enum(['anhydrous substance', 'hydrate']).optional(),
      potencyAs: z.enum(['parent', 'element']).optional(),
      assayAbove100: z.enum(['use', 'treat as 100']).optional(),
    }).strict().optional(),
    content: z.object({
      formulaQuantityIs: z.enum(['dry', 'wet']), nominalContent: z.string().optional(), contentSource: z.enum(['certificate', 'in-process result']).optional(),
      // What an in-process result is: the content, or a relative assay in % of theoretical (F0205).
      resultType: z.enum(['content', 'percent of theoretical']).optional(),
    }).strict().optional(),
    overage: z.object({ percent: decimal, maxPercent: decimal.optional() }).strict().optional(),
    compensates: z.array(keySchema).max(20).optional(),
  }).strict().optional(),
}).strict();

// Engine change 1 (owner, 16 Nov 2026): the liquid batch header. The batch is made in litres or kg (the formula is per
// mL; a batch in kg turns into its volume by the density) or, for a dry powder filled as it is, in units (the formula
// is per unit). A batch in L or kg is filled at the nominal fill plus its excess (overfill), which gives the expected
// units; nothing of these is typed in the batch.
export const BATCH_UNITS = ['L', 'kg', 'units'] as const;
export const ROUTES = ['terminal', 'aseptic', 'both'] as const;
export const CLAIM_PER = ['mL', 'container (filled content)', 'delivered dose', 'mL after reconstitution', 'dose of a multi-dose container', 'the mixed chambers'] as const;
export const headerSchema = z.object({
  productItemId: z.string().min(1).max(100),
  productCode: text(),
  productName: text(),
  batchSize: decimal,
  batchUnit: z.enum(BATCH_UNITS),
  // g/mL at the stated temperature: needed for a batch in kg, and for its mass when made in litres.
  densityGPerMl: decimal.optional(),
  // The nominal fill per container and the fill excess (overfill), in mL (a batch in L or kg).
  fillVolumeMl: decimal.optional(),
  fillExcessMl: decimal.optional(),
  // TI-01: how the product is made sterile (terminal sterilisation after filling, sterile filtration and aseptic
  // processing, or both). A draft may leave it empty; the master check asks for it.
  route: z.enum(ROUTES).optional(),
  // N1 (library check 17): what the API's label claim is per.
  claimPer: z.enum(CLAIM_PER).optional(),
  // TI-11: the rooms of master data (codes) where this product's materials are weighed; a balance is offered there or
  // in a room the stage allows (shared/engine/picks.ts). A version made before this setting has none.
  dispensingRooms: z.array(text()).max(20).optional(),
}).strict();

// Engine change 5: a time limit from step X (its start or end) to step Y (its start or end), at most N hours (TI-17:
// start of compounding → filtration, sterilisation → filling, total aseptic time …). Run on the hold-time timer.
// A draft may leave a step empty (the master check asks for it).
const pointSchema = z.object({ step: z.string().regex(/^([a-z0-9-]+\/[a-z0-9-]+)?$/, 'stage/step'), at: z.enum(['start', 'end']) }).strict();
export const timeLimitSchema = z.object({ key: keySchema, name: text(), from: pointSchema, to: pointSchema, hours: z.number().positive().max(100_000) }).strict();

// The author's answer to a calculation warning (checks.ts), keyed by the warning and its item. `about` is the warning
// as answered: when the warning reads differently (the item changed), it needs a new answer.
export const answerSchema = z.object({ about: text(1000), choice: text().min(1), reason: text(1000) }).strict();

// TrueBatch Injectables Packing (TI-P1): a packing master is per product, pack type and size, and destination. Its
// header names the finished pack product and the standard packing batch in filled units (batchSize, batchUnit "units");
// `pack` holds the rest. Its formula is empty: the packing materials are `pack.materials`, and a step setting
// { formula: key } names one of them. The units packed are the filled, inspected containers (vials, ampoules, syringes,
// bags) of a released TrueBatch Injectables batch.
export const PACK_TYPES = ['carton', 'tray', 'blister'] as const;
export const PACK_MATERIAL_KINDS = ['label', 'carton', 'leaflet', 'tray', 'blister film', 'lidding foil', 'shipper', 'other'] as const;
export const DESTINATIONS = ['India domestic', 'Export'] as const;
export const packMaterialSchema = z.object({
  key: keySchema,
  materialItemId: z.string().min(1).max(100),
  code: text(),
  name: text(),
  kind: z.enum(PACK_MATERIAL_KINDS),
  // Printed (artwork): issued only by its step with a second person, reconciled to zero (TI-P4, TI-P6).
  printed: z.boolean(),
  // Coded on the line with the batch number, dates and MRP (TI-P5, TI-P9); leftovers are destroyed.
  coded: z.boolean(),
  perPack: decimal,
  unit: z.enum(['units', 'm', 'g']),
}).strict();
export const packSchema = z.object({
  bulkItemId: z.string().min(1).max(100),
  bulkCode: text(),
  bulkName: text(),
  type: z.enum(PACK_TYPES),
  // Filled units (vials, ampoules, syringes, bags) in one pack, and packs in one outer carton.
  unitsPerPack: z.number().int().min(1).max(10_000),
  packsPerCarton: z.number().int().min(1).max(1000),
  // The approved shelf life (TI-P8): the expiry is worked out from it, never typed.
  shelfLifeMonths: z.number().int().min(1).max(120),
  // "month before": expiry = month of manufacture + shelf life − 1 (use before the end of that month).
  expiryRule: z.enum(['month before', 'same month']).default('month before'),
  destination: z.enum(DESTINATIONS),
  // Maximum retail price per pack in rupees (India domestic, TI-P9).
  mrp: decimal.optional(),
  // The pack's GTIN, for checking the codes of the customer's serialisation system.
  gtin: z.string().regex(/^\d{14}$/, '14 digits').optional(),
  serialisation: z.boolean().default(false),
  materials: z.array(packMaterialSchema).max(50),
}).strict();

// The containers and closures an injectables master issues by count (vials, stoppers, seals, syringes ...; owner,
// 17 Nov 2026, run 2 finding G9), picked from master data as a packing master picks its packing materials. A
// container issue step names one ({ formula: key }), so its lot is picked from MMS lots of that material.
export const containerSchema = z.object({ key: keySchema, materialItemId: z.string().min(1).max(100), code: text(), name: text() }).strict();

export const masterSchema = z.object({
  header: headerSchema,
  formula: z.array(lineSchema).max(100),
  stages: z.array(stageSchema).max(50),
  answers: z.record(z.string().max(120), answerSchema).optional(),
  timeLimits: z.array(timeLimitSchema).max(50).optional(),
  pack: packSchema.optional(),
  containers: z.array(containerSchema).max(30).optional(),
}).strict();

export type MasterDoc = z.infer<typeof masterSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Step = z.infer<typeof stepSchema>;
export type FormulaLine = z.infer<typeof lineSchema>;
export type SettingValue = z.infer<typeof settingValueSchema>;
export type Limit = z.infer<typeof limitSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type TimeLimit = z.infer<typeof timeLimitSchema>;
export type Pack = z.infer<typeof packSchema>;
export type PackMaterial = z.infer<typeof packMaterialSchema>;
export type Container = z.infer<typeof containerSchema>;

/** Every material a step may name: the formula lines and the containers and closures, or a packing master's packing materials. */
export const materialLines = (doc: MasterDoc): (FormulaLine | PackMaterial | Container)[] => [...doc.formula, ...(doc.pack?.materials ?? []), ...(doc.containers ?? [])];

export const MASTER_STATES = ['draft', 'in_review', 'approved', 'effective', 'retired'] as const;
export type MasterState = (typeof MASTER_STATES)[number];
