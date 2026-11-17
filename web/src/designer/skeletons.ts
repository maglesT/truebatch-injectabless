// Starting masters by injectable type and route (plan 4d): the usual stages and steps, as data. Settings that depend
// on the product (which material a step weighs, its limits, the cycle) are left for the author; the master check lists
// them. A stage worked in a room starts with line clearance (TI-10); a stage starts with the areas it usually runs in,
// and each area of master data with exactly one room becomes that room (run 3, H1 and H2: the master names the line's own
// room; with several rooms the author picks it, and the master check asks). Each starting master already has the steps the sterile rules of its
// route need (TI-23 to TI-31), so the master check shows only what is the product's own.
import { latestBlock } from '../../../shared/blocks/index.js';
import type { MasterDoc, Pack, SettingValue, Stage, Step } from '../../../shared/master/schema.js';

type Route = NonNullable<MasterDoc['header']['route']>;
import { newKey, stepFrom } from './model.js';

type Header = MasterDoc['header'];
interface StepPlan { block: string; key?: string; name?: string; checker?: boolean; settings?: (h: Header) => Record<string, SettingValue> }
interface StagePlan { key: string; name: string; kind?: Stage['kind']; role: string; rooms?: string[]; produces?: [string, number]; uses?: string[];
  aseptic?: boolean; startsAfter?: string; steps: StepPlan[] }

const s = (block: string, key?: string, name?: string): StepPlan => ({ block, ...(key ? { key } : {}), ...(name ? { name } : {}) });
// Containers and closures issued by count from an MMS lot (owner, 17 Nov 2026): at least the units expected and 2 % more;
// what is left is counted back at the end of the filling stage (run 2, G10). The author picks each one's material from
// master data (the Formula screen's containers and closures): the master check asks for it until then.
const issue = (what: string): StepPlan => ({ block: 'container-issue', key: `issue-${what}`, name: `Issue the ${what}`,
  settings: () => ({ expected: { header: 'units' }, enoughLimit: { low: '102.0', unit: '%' } }) });
const back = (what: string): StepPlan => ({ block: 'container-return', key: `back-${what}`, name: `Count back the ${what}` });
const VIAL_PARTS = ['vials', 'stoppers', 'seals'];
const yieldStep: StepPlan = { block: 'stage-yield', key: 'yield', settings: () => ({ theoretical: { header: 'batchMass' }, yieldLimit: { low: '97.0', high: '100.5', unit: '%' },
  accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } }) };

// The pieces most types share. Each stage after compounding ends with its reconciliation of units (its yield step).
const filtrationSteps = [s('filter-test', 'filter-pre', 'Filter integrity test before use'), s('filtration', 'filter'), s('filter-test', 'filter-post', 'Filter integrity test after use')];
const compounding = (end: StepPlan[] = []): StagePlan => ({ key: 'compounding', name: 'Compounding', role: 'Compounding operator', rooms: ['Sterile compounding', 'Sterile filtration'],
  produces: ['bulk solution', 24],
  steps: [s('weigh', 'weigh-api'), s('vehicle'), s('charge', 'charge-api'), s('dissolve'), s('ph-adjust'), s('make-up'), s('bulk-test'), ...end, yieldStep] });
const components: StagePlan = { key: 'components', name: 'Containers and closures', kind: 'preparation', role: 'Washing operator', rooms: ['Vial washing', 'Depyrogenation', 'Component preparation', 'Sterilisation'],
  produces: ['clean, depyrogenated containers and sterile closures', 72],
  steps: [issue('vials'), issue('stoppers'), s('component-wash', 'wash-vials', 'Wash the vials'), s('depyrogenate'), s('sterilise', 'stoppers', 'Sterilise the stoppers')] };
const asepticFill = (between: StepPlan[], o: { fill?: StepPlan[]; close?: StepPlan[]; uses?: string[]; back?: string[]; rooms?: string[] } = {}): StagePlan => ({
  key: 'filling', name: 'Aseptic filling', role: 'Aseptic operator', rooms: o.rooms ?? ['Aseptic filling', 'Capping'], aseptic: true, uses: o.uses ?? ['compounding', 'components'],
  // The interventions log and the clean-air checks open with the set-up and run beside the filling (what follows a fill
  // waits for the filling to finish).
  steps: [s('aseptic-ready'), s('interventions'), s('em-filling'), s('transfer-in'), ...(o.fill ?? [s('fill')]), ...between,
    // The samples are a QA hold: taken once the units are closed, so capping never waits for QA.
    ...(o.close ?? [issue('seals'), s('seal-check')]), s('qa-sample', 'sterility', 'Sterility and endotoxin samples'), ...(o.back ?? VIAL_PARTS).map(back), s('unit-reconcile')] });
// Aseptic blow-fill-seal (owner, 17 Nov 2026): the machine forms its containers from plastic granules issued by weight
// from an MMS lot (the container issue in kg, as Packing issues a material by weight) and weighed back at the end; it
// closes them itself (no stoppers or seals) and the leak test is in inspection.
// A form-fill-seal bag line issues its plastic film or granules the same way (run 3, H3).
const plastic = (key: string, what: string): [StepPlan, StepPlan] => [
  { block: 'container-issue', key: `issue-${key}`, name: `Issue the ${what}`, settings: () => ({ unit: 'kg', expected: '' }) },
  { block: 'container-return', key: `back-${key}`, name: `Weigh back the ${what}`, settings: () => ({ unit: 'kg' }) }];
const [granules, granulesBack] = plastic('granules', 'plastic granules');
const bfs: StagePlan = { key: 'filling', name: 'Aseptic blow-fill-seal', role: 'Aseptic operator', rooms: ['Aseptic filling'], aseptic: true, uses: ['compounding'],
  steps: [s('aseptic-ready'), s('interventions'), s('em-filling'), granules, s('ffs-run'), s('qa-sample', 'sterility', 'Sterility and endotoxin samples'), granulesBack, s('unit-reconcile')] };
const [film, filmBack] = plastic('plastic', 'plastic film or granules');
// Sterile powder (owner, 17 Nov 2026): the sterile drug substance is weighed in the sterile dispensing area, as any
// formula material, in a preparation stage as the containers are (no yield: the filling stage reconciles the units); no
// compounding and no filtration.
const dispensing: StagePlan = { key: 'dispensing', name: 'Sterile dispensing', kind: 'preparation', role: 'Dispensing operator', rooms: ['Sterile dispensing'], produces: ['dispensed sterile powder', 24],
  steps: [s('weigh', 'weigh-api', 'Weigh the sterile powder')] };
const resultsLater = (after: string): StagePlan => ({ key: 'results', name: 'Results later (EM plates, bioburden)', kind: 'preparation', role: 'QC microbiologist', rooms: [],
  startsAfter: after, steps: [s('incubated-results', 'plates', 'EM plates read')] });
const terminal = (fillName: string, fill: StepPlan[], uses: string[], after: StepPlan[], rooms: string[]): StagePlan[] => [
  { key: 'filling', name: fillName, role: 'Filling operator', rooms, uses, steps: [s('filtration-clarifying'), ...fill, ...after, s('unit-reconcile')] },
  { key: 'sterilisation', name: 'Terminal sterilisation', role: 'Sterilisation operator', rooms: ['Sterilisation'],
    steps: [s('terminal-sterilise'), s('qa-sample', 'sterility', 'Sterility and endotoxin samples (each load)'), s('unit-reconcile')] },
];
const inspection = (extra: StepPlan[] = []): StagePlan => ({ key: 'inspection', name: 'Inspection', role: 'Visual inspector', rooms: ['Visual inspection'],
  steps: [...extra, s('visual-inspect'), s('aql-sample'), s('unit-reconcile')] });

const SKELETONS: { id: string; route?: Route; name: string; text: string; stages: StagePlan[] }[] = [
  {
    // Any route: a bulk filled at another site or under another master.
    id: 'bulk-only', name: 'Bulk solution only (compounding, no filling)',
    text: 'Weighing, charging and mixing the bulk solution, an in-process check and the bulk yield; for a bulk filled elsewhere.',
    stages: [{ key: 'compounding', name: 'Compounding', role: 'Compounding operator', rooms: ['Sterile compounding'], produces: ['bulk solution', 24],
      steps: [s('weigh', 'weigh-api'), s('charge', 'charge-api'), s('mix'), s('check', 'ph', 'pH of the bulk solution'), yieldStep] }],
  },
  {
    id: 'liquid-terminal', route: 'terminal', name: 'Liquid in vials or ampoules, terminally sterilised',
    text: 'Compounding, clarifying filtration, filling and closing, autoclave loads with the sterility samples, leak test and inspection.',
    stages: [compounding(), components, ...terminal('Filling', [s('fill'), issue('seals'), s('seal-check')], ['compounding', 'components'], VIAL_PARTS.map(back), ['Aseptic filling', 'Capping']), inspection([s('leak-test-100')])],
  },
  {
    id: 'bag-terminal', route: 'terminal', name: 'Bags or bottles (large volume), form-fill-seal, terminally sterilised',
    text: 'Compounding, clarifying filtration, form-fill-seal, autoclave loads with the sterility samples, leak test and inspection.',
    // The machine forms, fills and seals the bag (no capping room). Master data has no area of its own for a terminally
    // sterilised large-volume line: its form-fill-seal room is one of the filling rooms, so the author picks it there.
    stages: [compounding(), ...terminal('Form-fill-seal', [film, s('ffs-run')], ['compounding'], [filmBack], ['Aseptic filling']), inspection([s('leak-test-100')])],
  },
  {
    id: 'liquid-aseptic', route: 'aseptic', name: 'Liquid in vials, sterile filtered and aseptically filled',
    text: 'Compounding and sterile filtration with filter tests, aseptic filling with clean-air checks and interventions, the plates read later, inspection.',
    stages: [compounding(filtrationSteps), components, asepticFill([]), resultsLater('filling/fill'), inspection()],
  },
  {
    id: 'lyo-aseptic', route: 'aseptic', name: 'Freeze-dried vials, aseptic',
    text: 'As the aseptic liquid, with the vials partly stoppered, loaded, freeze-dried, stoppered and unloaded before capping.',
    stages: [compounding(filtrationSteps), components, asepticFill([s('lyo-load'), s('lyo-cycle'), s('lyo-unload')], { rooms: ['Aseptic filling', 'Lyophilisation', 'Capping'] }), resultsLater('filling/fill'), inspection()],
  },
  {
    id: 'syringe-aseptic', route: 'aseptic', name: 'Prefilled syringes or cartridges, aseptic',
    text: 'Compounding and sterile filtration, ready-to-use tubs into grade A, filling and plunger placement, the plunger check, inspection.',
    stages: [compounding(filtrationSteps), asepticFill([s('plunger-check')], { fill: [issue('syringes'), issue('plungers'), s('rtu-tubs'), s('fill')], close: [], uses: ['compounding'], back: ['syringes', 'plungers'], rooms: ['Aseptic filling'] }),
      resultsLater('filling/fill'), inspection([s('leak-test-100')])],
  },
  {
    id: 'dispersion-aseptic', route: 'aseptic', name: 'Emulsion, liposomes or nanoparticles, aseptic',
    text: 'The oil (or lipid) and water phases, homogenised to size, sterile filtered and aseptically filled; samples at start, middle and end.',
    stages: [
      { key: 'compounding', name: 'Compounding', role: 'Compounding operator', rooms: ['Sterile compounding', 'Sterile filtration'], produces: ['bulk dispersion', 24],
        steps: [s('weigh', 'weigh-api'), s('phase-prep', 'oil', 'Prepare the oil (lipid) phase'), s('phase-prep', 'water', 'Prepare the water phase'), s('homogenise'),
          s('size-check'), s('make-up'), s('bulk-test'), ...filtrationSteps, yieldStep] },
      components,
      asepticFill([s('qa-sample', 'middle', 'Content sample, middle of filling'), s('qa-sample', 'end', 'Content sample, end of filling')]),
      resultsLater('filling/fill'), inspection()],
  },
  {
    id: 'bfs-aseptic', route: 'aseptic', name: 'Ampoules or nebules, blow-fill-seal, aseptic',
    text: 'Compounding and sterile filtration with filter tests, aseptic blow-fill-seal from plastic granules with clean-air checks and interventions, the plates read later, leak test and inspection.',
    stages: [compounding(filtrationSteps), bfs, resultsLater('filling/ffs-run'), inspection([s('leak-test-100')])],
  },
  {
    id: 'powder-aseptic', route: 'aseptic', name: 'Sterile powder in vials, aseptic powder filling',
    text: 'Sterile dispensing of the powder, vials washed and depyrogenated, stoppers sterilised, aseptic powder filling with clean-air checks and interventions, the plates read later, inspection.',
    stages: [dispensing, components, asepticFill([], { fill: [s('powder-fill')], uses: ['dispensing', 'components'] }), resultsLater('filling/powder-fill'), inspection()],
  },
];

/** The starting masters for a route (all of them before a route is chosen). */
export const skeletonList = (route?: Route) => SKELETONS.filter((k) => !route || !k.route || k.route === route || (route === 'both' && k.route === 'aseptic'))
  .map(({ id, name, text }) => ({ id, name, text }));

type MdRoom = { code: string; area: string | null; active: boolean };
/** A starting master's rooms (run 3, H1 and H2): an area of master data with exactly one active room becomes that room;
 *  an area with several stays, and the master check asks the author to pick the line's room (shared/master/places.ts). */
export const ownRooms = (areas: readonly string[], rooms: readonly MdRoom[]) => areas.map((a) => {
  const of = rooms.filter((r) => r.active && r.area === a);
  return of.length === 1 ? of[0]!.code : a;
});

/** The dispensing rooms a new master starts with (TI-11), by the same rule: the sterile dispensing room when master data
 *  has exactly one (an injectable is weighed in the sterile dispensing booth; the plain "Dispensing" area is the tablet
 *  one); with several, none: the author picks them in the header (the master check asks until then). */
export const defaultDispensingRooms = (rooms: readonly MdRoom[]) => ownRooms(['Sterile dispensing'], rooms).filter((c) => rooms.some((r) => r.code === c));

/** The stages of a starting master for this header; `rooms`: master data's rooms (an area with one room becomes that room). */
export function skeletonStages(id: string, h: Header, rooms: readonly MdRoom[] = []): Stage[] {
  const sk = SKELETONS.find((x) => x.id === id);
  if (!sk) return [];
  return sk.stages.map((p) => ({
    key: p.key, name: p.name, kind: p.kind ?? 'normal', roomTypes: ownRooms(p.rooms ?? [], rooms), machineTypes: [], role: p.role, uses: p.uses ?? [],
    ...(p.produces ? { produces: { name: p.produces[0], holdHours: p.produces[1] } } : {}),
    ...(p.aseptic ? { aseptic: true } : {}), ...(p.startsAfter ? { startsAfter: p.startsAfter } : {}),
    steps: [...(p.rooms?.length ? [{ block: 'line-clearance' }] : []), ...p.steps].reduce<Step[]>((steps, sp) => {
      const block = latestBlock(sp.block)!;
      const base = stepFrom(block, steps.map((t) => t.key));
      const settings = Object.fromEntries(Object.entries({ ...base.settings, ...sp.settings?.(h) }).filter(([, v]) => v !== ''));
      return [...steps, { ...base, ...(sp.key ? { key: sp.key } : {}), ...(sp.name ? { name: sp.name } : {}), settings, ...(sp.checker ? { checker: true } : {}) }];
    }, []),
  }));
}

/**
 * Adds a weighing for each excipient of the formula that no step weighs yet (run 3, H6: a starting master weighs the drug
 * substance; the demo's liquid masters weigh every excipient after it), as withMaterialSteps adds the packing materials'
 * steps: each a copy of the master's first weighing, its target the excipient, placed after the last weighing of that stage.
 */
export function withWeighSteps(doc: MasterDoc): MasterDoc {
  const target = (t: Step) => (t.settings.target as { formula?: string } | undefined)?.formula;
  const weighs = doc.stages.flatMap((st) => st.steps.filter((t) => t.block.id === 'weigh'));
  const first = doc.stages.findIndex((st) => st.steps.some((t) => t.block.id === 'weigh'));
  const missing = doc.formula.filter((l) => l.role === 'excipient' && !weighs.some((t) => target(t) === l.key));
  if (first < 0 || !missing.length) return doc;
  const stages = doc.stages.map((st) => ({ ...st, steps: [...st.steps] }));
  const steps = stages[first]!.steps;
  const base = steps.find((t) => t.block.id === 'weigh')!;
  const at = steps.map((t) => t.block.id).lastIndexOf('weigh') + 1;
  const taken = steps.map((t) => t.key);
  steps.splice(at, 0, ...missing.map((l) => {
    const key = newKey(`weigh-${l.key}`, taken);
    taken.push(key);
    const { name: _, ...copy } = base;
    return { ...copy, key, settings: { ...base.settings, target: { formula: l.key } } };
  }));
  return { ...doc, stages };
}

// TrueBatch Injectables Packing: the packing record for a pack and its materials. Issue to the line (the filled units of
// the released batch and each packing material); labelling and cartoning (line clearance, set-up, the camera and
// serial numbers when serialisation is checked, then the checks alongside the line: the coding on the labels and
// cartons, the labelled units and packs, the cartons with their leaflet); and the end (finished goods and filled units,
// every printed material, the serial numbers, destruction of coded leftovers, line clearance after). A blister pack
// (prefilled syringes) also has forming and the leak test. Limits that depend on the product are left for the author;
// the master check lists them.
export const PACKING_SKELETON = { id: 'packing', name: 'Packing record',
  text: 'Issue to the line, labelling and cartoning with the leaflet and the checks alongside the line, reconciliation of units and printed materials, and line clearance after, for this pack.' };
const packStep = (block: string, key?: string, settings: Record<string, SettingValue> = {}): Step => {
  const b = latestBlock(block)!;
  return { ...stepFrom(b, []), ...(key ? { key } : {}), settings, ...(b.stop ? { flow: { kind: 'repeat-until' as const, maxRounds: 100 } } : {}) };
};
const issueStep = (m: Pack['materials'][number]) => packStep('pack-material-issue', `issue-${m.key}`, { material: { formula: m.key }, unit: m.unit });
const reconcileStep = (m: Pack['materials'][number]) => packStep('printed-reconciliation', `reconcile-${m.key}`, { material: { formula: m.key }, unit: m.unit, issued: { ref: `issue/issue-${m.key}/issued` } });
const packStage = (key: string, name: string, role: string, steps: Step[], roomTypes: string[] = []): Stage => ({ key, name, kind: 'normal', roomTypes, machineTypes: [], role, uses: [], steps });

/** The area injectables are packed in (master data's area name): the sterile packing hall, never a tablet packing room. */
const PACK_AREA = 'Sterile packing';

export function packingStages(pack: Pack): Stage[] {
  const blister = pack.type === 'blister';
  const serial = pack.serialisation;
  return [
    // The issue is a warehouse step (no room, no line clearance); a master limits the line it issues to by the stage's machine types.
    packStage('issue', 'Issue to the line', 'Packing operator', [packStep('bulk-issue', 'bulk'), ...pack.materials.map(issueStep)]),
    packStage('packing', 'Labelling and cartoning', 'Packing operator', [packStep('pack-clearance', 'clearance'), packStep('line-setup', 'setup'),
      ...(serial ? [packStep('vision-challenge', 'camera'), packStep('serial-received', 'serials')] : []), packStep('coding-check', 'coding'),
      ...(blister ? [packStep('forming-check', 'forming'), packStep('leak-test', 'leak', { vacuumUnit: 'mbar', level: 'S-2', aql: '0.65' })] : []),
      packStep('online-inspection', 'inspection'), packStep('carton-check', 'cartons'), ...(serial ? [packStep('serial-sample', 'serial-sample')] : [])], [PACK_AREA]),
    packStage('end', 'Reconciliation and line clearance', 'Packing supervisor', [
      packStep('finished-goods', 'finished', { yieldLimit: { low: '98.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.5', high: '100.5', unit: '%' } }),
      ...pack.materials.filter((m) => m.printed).map(reconcileStep),
      ...(serial ? [packStep('serial-reconciliation', 'serial-reconciliation', { received: { ref: 'packing/serials/received' } })] : []),
      packStep('destruction'), packStep('pack-clearance-after', 'clearance-after')], [PACK_AREA]),
  ];
}

/** Adds the issue and reconciliation steps of packing materials that have none (to the first and last stages). */
export function withMaterialSteps(doc: MasterDoc): MasterDoc {
  const p = doc.pack;
  const first = doc.stages[0];
  const last = doc.stages.at(-1);
  if (!p || !first || !last) return doc;
  const names = (s: Stage, block: string) => s.steps.filter((t) => t.block.id === block).map((t) => (t.settings.material as { formula?: string } | undefined)?.formula);
  const issue = p.materials.filter((m) => !names(first, 'pack-material-issue').includes(m.key)).map(issueStep);
  const recon = p.materials.filter((m) => m.printed && !names(last, 'printed-reconciliation').includes(m.key)).map(reconcileStep);
  const at = Math.max(0, last.steps.findIndex((t) => t.block.id === 'destruction' || t.block.id === 'pack-clearance-after'));
  const stages = doc.stages.map((s) => ({ ...s, steps: [...s.steps] }));
  stages[0]!.steps.push(...issue);
  stages.at(-1)!.steps.splice(at, 0, ...recon);
  return { ...doc, stages };
}
