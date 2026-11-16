// Starting masters by injectable type and route (plan 4d): the usual stages and steps, as data. Settings that depend
// on the product (which material a step weighs, its limits, the cycle) are left for the author; the master check lists
// them. A stage worked in a room starts with line clearance (TI-10); a stage starts with the rooms it
// usually runs in, by the usual area names (TI-11). Each starting master already has the steps the sterile rules of its
// route need (TI-23 to TI-31), so the master check shows only what is the product's own.
import { findBlock } from '../../../shared/blocks/index.js';
import type { MasterDoc, SettingValue, Stage, Step } from '../../../shared/master/schema.js';

type Route = NonNullable<MasterDoc['header']['route']>;
import { stepFrom } from './model.js';

type Header = MasterDoc['header'];
interface StepPlan { block: string; key?: string; name?: string; checker?: boolean; settings?: (h: Header) => Record<string, SettingValue> }
interface StagePlan { key: string; name: string; kind?: Stage['kind']; role: string; rooms?: string[]; produces?: [string, number]; uses?: string[];
  aseptic?: boolean; startsAfter?: string; steps: StepPlan[] }

const s = (block: string, key?: string, name?: string): StepPlan => ({ block, ...(key ? { key } : {}), ...(name ? { name } : {}) });
const yieldStep: StepPlan = { block: 'stage-yield', key: 'yield', settings: () => ({ theoretical: { header: 'batchMass' }, yieldLimit: { low: '97.0', high: '100.5', unit: '%' },
  accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } }) };

// The pieces most types share. Each stage after compounding ends with its reconciliation of units (its yield step).
const filtrationSteps = [s('filter-test', 'filter-pre', 'Filter integrity test before use'), s('filtration', 'filter'), s('filter-test', 'filter-post', 'Filter integrity test after use')];
const compounding = (end: StepPlan[] = []): StagePlan => ({ key: 'compounding', name: 'Compounding', role: 'Compounding operator', rooms: ['Sterile compounding', 'Sterile filtration'],
  produces: ['bulk solution', 24],
  steps: [s('weigh', 'weigh-api'), s('vehicle'), s('charge', 'charge-api'), s('dissolve'), s('ph-adjust'), s('make-up'), s('bulk-test'), ...end, yieldStep] });
const components: StagePlan = { key: 'components', name: 'Containers and closures', kind: 'preparation', role: 'Washing operator', rooms: ['Vial washing', 'Depyrogenation', 'Component preparation', 'Sterilisation'],
  produces: ['clean, depyrogenated containers and sterile closures', 72],
  steps: [s('component-wash', 'wash-vials', 'Wash the vials'), s('depyrogenate'), s('sterilise', 'stoppers', 'Sterilise the stoppers')] };
const asepticFill = (between: StepPlan[], o: { fill?: StepPlan[]; close?: StepPlan[]; uses?: string[] } = {}): StagePlan => ({
  key: 'filling', name: 'Aseptic filling', role: 'Aseptic operator', rooms: ['Aseptic filling', 'Lyophilisation', 'Capping'], aseptic: true, uses: o.uses ?? ['compounding', 'components'],
  // The interventions log and the clean-air checks open with the set-up and run beside the filling (what follows a fill
  // waits for the filling to finish).
  steps: [s('aseptic-ready'), s('interventions'), s('em-filling'), s('transfer-in'), ...(o.fill ?? [s('fill')]), ...between,
    // The samples are a QA hold: taken once the units are closed, so capping never waits for QA.
    ...(o.close ?? [s('seal-check')]), s('qa-sample', 'sterility', 'Sterility and endotoxin samples'), s('unit-reconcile')] });
const resultsLater = (after: string): StagePlan => ({ key: 'results', name: 'Results later (EM plates, bioburden)', kind: 'preparation', role: 'QC microbiologist', rooms: [],
  startsAfter: after, steps: [s('incubated-results', 'plates', 'EM plates read')] });
const terminal = (fillName: string, fill: StepPlan[], uses: string[]): StagePlan[] => [
  { key: 'filling', name: fillName, role: 'Filling operator', rooms: ['Aseptic filling', 'Capping'], uses, steps: [s('filtration-clarifying'), ...fill, s('unit-reconcile')] },
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
    stages: [compounding(), components, ...terminal('Filling', [s('fill'), s('seal-check')], ['compounding', 'components']), inspection([s('leak-test-100')])],
  },
  {
    id: 'bag-terminal', route: 'terminal', name: 'Bags or bottles (large volume), form-fill-seal, terminally sterilised',
    text: 'Compounding, clarifying filtration, form-fill-seal, autoclave loads with the sterility samples, leak test and inspection.',
    stages: [compounding(), ...terminal('Form-fill-seal', [s('ffs-run')], ['compounding']), inspection([s('leak-test-100')])],
  },
  {
    id: 'liquid-aseptic', route: 'aseptic', name: 'Liquid in vials, sterile filtered and aseptically filled',
    text: 'Compounding and sterile filtration with filter tests, aseptic filling with clean-air checks and interventions, the plates read later, inspection.',
    stages: [compounding(filtrationSteps), components, asepticFill([]), resultsLater('filling/fill'), inspection()],
  },
  {
    id: 'lyo-aseptic', route: 'aseptic', name: 'Freeze-dried vials, aseptic',
    text: 'As the aseptic liquid, with the vials partly stoppered, loaded, freeze-dried, stoppered and unloaded before capping.',
    stages: [compounding(filtrationSteps), components, asepticFill([s('lyo-load'), s('lyo-cycle'), s('lyo-unload')]), resultsLater('filling/fill'), inspection()],
  },
  {
    id: 'syringe-aseptic', route: 'aseptic', name: 'Prefilled syringes or cartridges, aseptic',
    text: 'Compounding and sterile filtration, ready-to-use tubs into grade A, filling and plunger placement, the plunger check, inspection.',
    stages: [compounding(filtrationSteps), asepticFill([s('plunger-check')], { fill: [s('rtu-tubs'), s('fill')], close: [], uses: ['compounding'] }),
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
];

/** The starting masters for a route (all of them before a route is chosen). */
export const skeletonList = (route?: Route) => SKELETONS.filter((k) => !route || !k.route || k.route === route || (route === 'both' && k.route === 'aseptic'))
  .map(({ id, name, text }) => ({ id, name, text }));

/** The dispensing rooms a new master starts with (TI-11): the active rooms whose area is exactly "Dispensing" or "Sterile dispensing". */
export const defaultDispensingRooms = (rooms: readonly { code: string; area: string | null; active: boolean }[]) =>
  rooms.filter((r) => r.active && (r.area === 'Dispensing' || r.area === 'Sterile dispensing')).map((r) => r.code);

/** The stages of a starting master for this header. */
export function skeletonStages(id: string, h: Header): Stage[] {
  const sk = SKELETONS.find((x) => x.id === id);
  if (!sk) return [];
  return sk.stages.map((p) => ({
    key: p.key, name: p.name, kind: p.kind ?? 'normal', roomTypes: p.rooms ?? [], machineTypes: [], role: p.role, uses: p.uses ?? [],
    ...(p.produces ? { produces: { name: p.produces[0], holdHours: p.produces[1] } } : {}),
    ...(p.aseptic ? { aseptic: true } : {}), ...(p.startsAfter ? { startsAfter: p.startsAfter } : {}),
    steps: [...(p.rooms?.length ? [{ block: 'line-clearance' }] : []), ...p.steps].reduce<Step[]>((steps, sp) => {
      const block = findBlock({ id: sp.block, version: 1 })!;
      const base = stepFrom(block, steps.map((t) => t.key));
      const settings = Object.fromEntries(Object.entries({ ...base.settings, ...sp.settings?.(h) }).filter(([, v]) => v !== ''));
      return [...steps, { ...base, ...(sp.key ? { key: sp.key } : {}), ...(sp.name ? { name: sp.name } : {}), settings, ...(sp.checker ? { checker: true } : {}) }];
    }, []),
  }));
}
