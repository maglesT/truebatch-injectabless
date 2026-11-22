import type { Block } from './format.js';

// TrueBatch Injectables library v1, sections 4.3 to 4.8: aseptic processing, freeze-drying, prefilled syringes and
// cartridges, bags and bottles, emulsions/suspensions/depots/liposomes, multi-chamber containers. Data only.

const yes = (name: string, label: string, optional = false) => ({ name, label, kind: 'yes-no' as const, ...(optional ? { optional: true } : {}) });
const time = (name: string, label: string, optional = false) => ({ name, label, kind: 'timer' as const, ...(optional ? { optional: true } : {}) });
const num = (name: string, label: string, unit: string, optional = false) => ({ name, label, kind: 'number' as const, unit, ...(optional ? { optional: true } : {}) });
const text = (name: string, label: string, optional = false) => ({ name, label, kind: 'text' as const, ...(optional ? { optional: true } : {}) });
const useBy = (name: string, label: string) => ({ name, label, kind: 'text' as const, date: true, useBy: true });
const limit = (name: string, label: string, optional = true) => ({ name, label, kind: 'limit' as const, ...(optional ? { optional: true } : {}) });
const within = (name: string, label: string, value: string, lim: string) => ({ name, label, template: 'C1', args: { value: `$${value}`, limit: `$${lim}` } });
const observe = (name: string, label: string, answers: string[]) => ({ name, label, template: 'C4', args: { question: label, answers: answers.map((a) => `$${a}`), expected: ['yes'] } });
const duration = (name: string, label: string, start: string, end: string, lim: string) => ({ name, label, template: 'T13', args: { mode: 'duration', start: `$${start}`, end: `$${end}`, ...(lim ? { limit: `$${lim}` } : {}) } });
const finished = (field: string, what: string) => ({ name: 'done', label: `${what} finished`, template: 'C4', args: { question: what, answers: [`$${field}`], expected: ['finished'], options: ['going on', 'finished'] } });
const going = (name: string, label: string) => ({ name, label, kind: 'choice' as const, options: ['going on', 'finished'] });

// ---- 4.3 Aseptic processing

// 24. Aseptic set-up: people qualified, the line's media fill, sterilised items in date, glove test, grade A air.
export const asepticReady: Block = {
  id: 'aseptic-ready', version: 1, name: 'Aseptic set-up', checker: true,
  instruction: 'Before aseptic work: people in grade A/B qualified, the line\'s media fill in date, sterilised items within their use-by, gloves tested, grade A airflow and pressure as specified, and the aseptic assembly done.',
  fields: [
    yes('people', 'Everyone in grade A/B qualified (gowning, aseptic operator)'), text('apsReport', 'Line media fill report'),
    useBy('apsDue', 'Line media fill next due'), useBy('itemsUseBy', 'Earliest use-by of the sterilised items'),
    yes('gloves', 'Glove integrity test passed'), yes('airflow', 'Grade A airflow and pressure as specified'), yes('assembly', 'Aseptic assembly done'),
  ],
  settings: [],
  calcs: [observe('ready', 'Ready for aseptic work', ['people', 'gloves', 'airflow', 'assembly'])],
};

// 24, version 2 (owner, 17 Nov 2026, demo finding F19): the isolator or RABS is a machine pulled from the Logbook, first,
// so its glove test and decontamination there decide whether it may be used. Version 1 stays for the recorded batches.
export const asepticReady2: Block = {
  ...asepticReady, version: 2,
  fields: [{ name: 'isolator', label: 'Isolator or RABS', kind: 'machine', types: ['isolator', 'rabs'] }, ...asepticReady.fields],
};

// 24, version 3 (owner, 17 Nov 2026, run 2 finding G7): no typed "glove integrity test passed": the Logbook decides the
// glove test (and the decontamination) through the isolator or RABS field. The line's media fill stays typed.
export const asepticReady3: Block = {
  ...asepticReady2, version: 3,
  instruction: 'Before aseptic work: the isolator or RABS fit for use in the Logbook (its glove test and decontamination), people in grade A/B qualified, the line\'s media fill in date, sterilised items within their use-by, grade A airflow and pressure as specified, and the aseptic assembly done.',
  fields: asepticReady2.fields.filter((f) => f.name !== 'gloves'),
  calcs: [observe('ready', 'Ready for aseptic work', ['people', 'airflow', 'assembly'])],
};

// 24, version 4 (owner, 17 Nov 2026, aseptic blow-fill-seal): a blow-fill-seal machine has no isolator or RABS; its own
// grade A air shower is its barrier, so the machine field also takes the BFS machine, whose cleaning and sterilisation
// in place the Logbook decides. Version 3 stays for the recorded batches.
export const asepticReady4: Block = {
  ...asepticReady3, version: 4,
  instruction: 'Before aseptic work: the isolator, RABS or blow-fill-seal machine fit for use in the Logbook, people in grade A/B qualified, the line\'s media fill in date, sterilised items within their use-by, grade A airflow and pressure as specified, and the aseptic assembly done.',
  fields: asepticReady3.fields.map((f) => (f.name === 'isolator' ? { ...f, label: 'Isolator, RABS or blow-fill-seal machine', types: ['isolator', 'rabs', 'blow'] } : f)),
};

// 25. Isolator or RABS decontamination (VHP): the cycle, the H2O2 at the end of aeration, indicators; its use-by.
export const isolatorDecon: Block = {
  id: 'isolator-decon', version: 1, name: 'Isolator or RABS decontamination', checker: true,
  instruction: 'Leak test the isolator, run the validated decontamination cycle, check the printout, the H2O2 at the end of aeration and the indicators.',
  fields: [
    { name: 'isolator', label: 'Isolator or RABS', kind: 'machine', types: ['isolator', 'rabs'] },
    num('leakRate', 'Leak test', 'mbar·L/s', true), text('printout', 'Cycle printout reference'), num('h2o2', 'H2O2 at the end of aeration', 'ppm'),
    yes('indicator', 'Chemical indicator passed'), text('bi', 'Biological indicator ID (result later)', true), useBy('useBy', 'Decontamination valid until'),
  ],
  settings: [limit('leakLimit', 'Leak rate limit'), limit('h2o2Limit', 'H2O2 limit at the end of aeration', false)],
  calcs: [within('leakCheck', 'Leak rate', 'leakRate?', 'leakLimit?'), within('h2o2Check', 'H2O2 after aeration', 'h2o2', 'h2o2Limit'), observe('indicatorCheck', 'Chemical indicator', ['indicator'])],
};

// 26. Transfer of sterile items into grade A: the load, its use-by (engine change 6) and the method.
export const transferIn: Block = {
  id: 'transfer-in', version: 1, name: 'Transfer sterile items into grade A', checker: false,
  instruction: 'Transfer the sterilised items by the method shown; check the wrap is intact and the load is within its use-by.',
  fields: [
    text('item', 'Item'), text('load', 'Sterilisation load'), useBy('useBy', 'Use-by date of the load'),
    { name: 'method', label: 'Transfer method', kind: 'choice', options: ['RTP port', 'beta bag', 'wiped wrap', 'UV tunnel'] },
    yes('intact', 'Wrap intact'),
  ],
  settings: [],
  calcs: [observe('intactCheck', 'Wrap intact', ['intact'])],
};

// 27. Environmental monitoring during filling: particles now, plates read later (incubated-results).
export const emFilling: Block = {
  id: 'em-filling', version: 1, name: 'Environmental monitoring during filling', checker: false, periodic: { maxMinutes: 240, alongside: true }, stop: 'done',
  instruction: 'At each round record the particle counts per location, change the settle plates (at most 4 h each) and take the active air and personnel samples; the plates are read later.',
  fields: [
    text('location', 'Location'), num('particles05', 'Particles ≥ 0.5 µm', 'particles/m³'), num('particles5', 'Particles ≥ 5 µm', 'particles/m³'),
    text('plateIds', 'Settle plate IDs (out and in)'), time('plateOut', 'Plates put out at'), time('plateIn', 'Plates collected at'),
    text('airSample', 'Active air sample ID', true), text('personnel', 'Glove and gown sample IDs', true), going('filling', 'Filling'),
  ],
  settings: [limit('particles05Limit', 'Particle limit ≥ 0.5 µm (from the clean-air table)', false), limit('particles5Limit', 'Particle limit ≥ 5 µm (from the clean-air table)', false)],
  calcs: [
    within('particles05Check', 'Particles ≥ 0.5 µm', 'particles05', 'particles05Limit'), within('particles5Check', 'Particles ≥ 5 µm', 'particles5', 'particles5Limit'),
    { name: 'exposure', label: 'Settle plate exposure', template: 'T13', args: { mode: 'duration', start: '$plateOut', end: '$plateIn', limit: { high: '4', unit: 'h' }, unit: 'h' } },
    finished('filling', 'Filling'),
  ],
};

// 27b. Environmental monitoring during filling, version 2 (template round part 4, I22): the limit is the clean-air table's
// for the room's grade and state, never looser; the master may only set a tighter action limit.
const GRADE = { name: 'grade', label: 'Room grade', kind: 'text' as const, options: ['A', 'B', 'C', 'D'] };
export const emFilling2: Block = {
  ...emFilling, version: 2,
  settings: [GRADE, { name: 'state', label: 'Room state', kind: 'text', options: ['at rest', 'in operation'] },
    { name: 'limit05', label: 'Tighter action limit ≥ 0.5 µm (e.g. "3000 particles/m³"; none: the table\'s)', kind: 'text', optional: true },
    { name: 'limit5', label: 'Tighter action limit ≥ 5 µm (none: the table\'s)', kind: 'text', optional: true }],
  calcs: [
    { name: 'particles05Check', label: 'Particles ≥ 0.5 µm against the clean-air table', template: 'I22', args: { sample: 'particles ≥0.5 µm', counts: '$particles05', grade: '$grade', state: '$state', actionLimit: '$limit05?' } },
    { name: 'particles5Check', label: 'Particles ≥ 5 µm against the clean-air table', template: 'I22', args: { sample: 'particles ≥5 µm', counts: '$particles5', grade: '$grade', state: '$state', actionLimit: '$limit5?' } },
    ...emFilling.calcs.filter((c) => c.name === 'exposure' || c.name === 'done'),
  ],
};

// 28. Interventions and stoppages (TI-28): an event log (engine change 2). An intervention not on the master's list of
// validated ones fails the check and needs a deviation note (F3).
export const interventions: Block = {
  id: 'interventions', version: 1, name: 'Interventions and stoppages (log)', checker: false, log: true,
  instruction: 'Add an entry for each intervention or stoppage: what (from the master\'s list), when, who, units removed and EM taken after.',
  fields: [
    text('what', 'Intervention or stoppage'), yes('onList', 'On the master\'s list of validated interventions'), time('start', 'Start'), time('end', 'End'),
    text('who', 'Operators involved'), num('removed', 'Units removed', 'units'), text('emAfter', 'EM samples taken after', true),
  ],
  settings: [],
  calcs: [observe('qualified', 'A validated intervention', ['onList']), duration('time', 'Duration', 'start', 'end', '')],
};

// 29. Incubated results (EM, BIs, bioburden): in a stage that starts after the step that took them (engine change 3).
export const incubatedResults: Block = {
  id: 'incubated-results', version: 1, name: 'Incubated results (EM, BIs, bioburden)', checker: true,
  instruction: 'When the incubation is over, read each sample and record the count or growth against its limit.',
  fields: [
    text('sampleId', 'Sample ID'), { name: 'kind', label: 'Sample', kind: 'choice', options: ['air sample', 'settle plate', 'contact plate', 'glove print', 'biological indicator', 'bioburden'] },
    time('incubationStart', 'Incubation start'), time('incubationEnd', 'Incubation end'), num('count', 'Count (CFU; a BI: 0 = no growth)', 'CFU'),
  ],
  settings: [limit('countLimit', 'Action limit (from the clean-air table, or the product\'s bioburden limit)', false), limit('incubationLimit', 'Incubation time limits')],
  calcs: [within('countCheck', 'Count', 'count', 'countLimit'), duration('incubation', 'Incubation time', 'incubationStart', 'incubationEnd', 'incubationLimit?')],
};

// 29a and 29b (owner rule 19 Nov 2026: the product that owns a job keeps it; duplicates review item 10): incubated
// results split in two. Masters made before keep incubated-results (29) unchanged.
// 29a. EM plates read after incubation: for a plant WITHOUT Medhanta LIMS. With LIMS linked, LIMS owns the EM results
// (em_v1): QC reviews them at QC approval and the master check says this step would type them again.
export const incubatedEm: Block = {
  id: 'incubated-em', version: 1, name: 'EM plates read (without LIMS)', checker: true,
  instruction: 'When the incubation is over, read each EM plate or sample and record the count against its limit.',
  fields: [
    text('sampleId', 'Sample ID'), { name: 'kind', label: 'Sample', kind: 'choice', options: ['air sample', 'settle plate', 'contact plate', 'glove print'] },
    time('incubationStart', 'Incubation start'), time('incubationEnd', 'Incubation end'), num('count', 'Count', 'CFU'),
  ],
  settings: [limit('countLimit', 'Action limit (from the clean-air table)', false), limit('incubationLimit', 'Incubation time limits')],
  calcs: [within('countCheck', 'Count', 'count', 'countLimit'), duration('incubation', 'Incubation time', 'incubationStart', 'incubationEnd', 'incubationLimit?')],
};

// 29a, version 2 (I22): the count turned to its basis (per m³ of air from the litres sampled, per plate, per glove) and
// checked against the clean-air table for the room's grade; a tighter action limit may be set, never a looser one.
export const incubatedEm2: Block = {
  ...incubatedEm, version: 2,
  fields: [
    text('sampleId', 'Sample ID'), { name: 'kind', label: 'Sample', kind: 'choice', options: ['air', 'settle plate', 'contact plate', 'glove print'] },
    time('incubationStart', 'Incubation start'), time('incubationEnd', 'Incubation end'), num('count', 'Count', 'CFU'),
    num('sampled', 'Air sampled (an air sample)', 'L', true), num('exposure', 'Plate exposure (a settle plate)', 'h', true),
  ],
  settings: [GRADE, { name: 'limit', label: 'Tighter action limit (e.g. "5 CFU/plate"; none: the table\'s)', kind: 'text', optional: true }, limit('incubationLimit', 'Incubation time limits')],
  calcs: [
    { name: 'countCheck', label: 'Count against the clean-air table', template: 'I22', args: { sample: '$kind', counts: '$count', sampled: '$sampled?', exposure: '$exposure?', grade: '$grade', actionLimit: '$limit?' } },
    duration('incubation', 'Incubation time', 'incubationStart', 'incubationEnd', 'incubationLimit?'),
  ],
};

// 29c. Bioburden before filtration or sterilisation (template round part 4): the count per 100 mL of product from the
// millilitres filtered (I22), a QC lab result picked from LIMS as the biological indicator's is.
export const incubatedBioburden: Block = {
  id: 'incubated-bioburden', version: 1, name: 'Bioburden results (per 100 mL)', checker: true,
  instruction: 'Pick the count of each bioburden sample from LIMS once QC has approved it (typed from the QC report only while LIMS cannot be reached) and the volume of product filtered.',
  fields: [text('sampleId', 'Sample ID'), num('volume', 'Product filtered', 'mL'), { ...num('count', 'Count', 'CFU'), qc: 'in_process' }],
  settings: [{ name: 'bioburdenLimit', label: 'Bioburden limit (per 100 mL, e.g. "10 CFU/100 mL")', kind: 'text' }, { name: 'alertLimit', label: 'Alert limit (per 100 mL)', kind: 'text', optional: true }],
  calcs: [{ name: 'countCheck', label: 'Bioburden per 100 mL', template: 'I22', args: { sample: 'bioburden', counts: '$count', sampled: '$volume', actionLimit: '$bioburdenLimit', alertLimit: '$alertLimit?' } }],
};

// 29b. Biological indicator and bioburden results: QC lab tests of the batch's samples, picked from LIMS's approved
// in-process report of the step's lab request while LIMS answers (rounds 40 to 44); typed from the QC report otherwise.
export const incubatedLab: Block = {
  id: 'incubated-lab', version: 1, name: 'Biological indicator and bioburden results', checker: true,
  instruction: 'Pick the result of each biological indicator or bioburden sample from LIMS once QC has approved it (typed from the QC report only while LIMS cannot be reached).',
  fields: [
    text('sampleId', 'Sample ID'), { name: 'kind', label: 'Sample', kind: 'choice', options: ['biological indicator', 'bioburden'] },
    { ...num('count', 'Count (CFU; a BI: 0 = no growth)', 'CFU'), qc: 'in_process' },
  ],
  settings: [limit('countLimit', 'Limit (no growth for a BI, or the product\'s bioburden limit)', false)],
  calcs: [within('countCheck', 'Count', 'count', 'countLimit')],
};

// ---- 4.4 Freeze-drying

// 30. Load the freeze-dryer (vials partly stoppered, or bulk trays of an intermediate).
export const lyoLoad: Block = {
  id: 'lyo-load', version: 1, name: 'Load the freeze-dryer', checker: true,
  instruction: 'Check the freeze-dryer is sterilised and leak tested, load the shelves as validated and place the product probes.',
  fields: [
    { name: 'dryer', label: 'Freeze-dryer', kind: 'machine', types: ['freeze', 'lyophil'] },
    text('sip', 'Sterilisation (SIP) record'), num('leakRate', 'Chamber leak rate', 'mbar·L/s'), num('shelfTemp', 'Shelf temperature', '°C'),
    num('loaded', 'Vials or trays loaded', 'units'), yes('stoppered', 'Partly stoppered (vials)', true), num('probes', 'Product probes placed', 'units'),
    time('firstFill', 'First unit filled at'), time('loadedAt', 'Loading finished at'),
  ],
  settings: [limit('leakLimit', 'Leak rate limit', false), limit('shelfLimit', 'Shelf temperature limits'), limit('loadingLimit', 'Loading time from the first fill'), { name: 'probeCount', label: 'Probes required', kind: 'number' }],
  calcs: [
    within('leakCheck', 'Leak rate', 'leakRate', 'leakLimit'), within('shelfCheck', 'Shelf temperature', 'shelfTemp', 'shelfLimit?'),
    duration('loading', 'Loading time from the first fill', 'firstFill', 'loadedAt', 'loadingLimit?'),
    { name: 'probeCheck', label: 'Probes placed', template: 'C2', args: { readings: '$probes', required: '$probeCount', mode: 'at least' } },
  ],
};

// 31. The freeze-drying cycle: each phase from the printout (phases the master leaves out are left empty).
export const lyoCycle: Block = {
  id: 'lyo-cycle', version: 1, name: 'Freeze-drying cycle', checker: true,
  instruction: 'Run the validated recipe; from the printout record each phase\'s time, the shelf temperature and chamber pressure ranges, the product probe maximum and the end-of-primary test.',
  fields: [
    text('recipe', 'Recipe number'), text('printout', 'Printout reference'),
    num('freezeShelfMin', 'Freezing: lowest shelf temperature', '°C', true),
    num('primaryPressureMax', 'Primary drying: highest chamber pressure', 'µbar', true), num('primaryShelfMax', 'Primary drying: highest shelf temperature', '°C', true),
    num('secondaryShelfMax', 'Secondary drying: highest shelf temperature', '°C', true), num('productMax', 'Highest product probe temperature', '°C', true),
    num('pressureRise', 'End of primary: pressure rise (or Pirani − capacitance)', 'µbar', true), yes('noAlarm', 'No alarm during the cycle'),
  ],
  settings: [limit('freezeLimit', 'Freezing shelf temperature'), limit('primaryPressureLimit', 'Primary drying pressure'), limit('primaryShelfLimit', 'Primary drying shelf temperature'),
    limit('secondaryShelfLimit', 'Secondary drying shelf temperature'), limit('productLimit', 'Product temperature limit (collapse)'), limit('riseLimit', 'End-of-primary test limit')],
  calcs: [
    within('freezeCheck', 'Freezing shelf temperature', 'freezeShelfMin?', 'freezeLimit?'), within('primaryPressureCheck', 'Primary drying pressure', 'primaryPressureMax?', 'primaryPressureLimit?'),
    within('primaryShelfCheck', 'Primary drying shelf temperature', 'primaryShelfMax?', 'primaryShelfLimit?'), within('secondaryShelfCheck', 'Secondary drying shelf temperature', 'secondaryShelfMax?', 'secondaryShelfLimit?'),
    within('productCheck', 'Product temperature', 'productMax?', 'productLimit?'), within('riseCheck', 'End of primary drying', 'pressureRise?', 'riseLimit?'),
    observe('alarmCheck', 'No alarm', ['noAlarm']),
  ],
};

// 32. Stopper and unload: backfill, stoppering pressure, vials unloaded and damaged, time to capping.
export const lyoUnload: Block = {
  id: 'lyo-unload', version: 1, name: 'Stopper and unload the freeze-dryer', checker: true,
  instruction: 'Backfill and stopper as validated, unload, count the units not stoppered or damaged, and cap within the time shown.',
  fields: [
    { name: 'gas', label: 'Backfill gas', kind: 'choice', options: ['nitrogen', 'air', 'none (trays)'] }, num('stopperPressure', 'Stoppering pressure (absolute)', 'mbar', true),
    num('unloaded', 'Units or trays unloaded', 'units'), num('damaged', 'Not stoppered or damaged', 'units'), time('unloadedAt', 'Unloading finished at'), time('cappedAt', 'Capping finished at'),
  ],
  settings: [limit('stopperLimit', 'Stoppering pressure limits'), limit('cappingLimit', 'Time from unloading to capping'), { name: 'loaded', label: 'Units loaded', kind: 'quantity' }],
  calcs: [
    within('stopperCheck', 'Stoppering pressure', 'stopperPressure?', 'stopperLimit?'),
    duration('toCapping', 'Unloading to capping', 'unloadedAt', 'cappedAt', 'cappingLimit?'),
    { name: 'balance', label: 'Units loaded, accounted for', template: 'T4', args: { input: '$loaded', parts: [{ name: 'unloaded', value: '$unloaded' }, { name: 'damaged', value: '$damaged' }] } },
  ],
};

// ---- 4.5 Prefilled syringes and cartridges

// 33. Ready-to-use nested containers in tubs.
export const rtuTubs: Block = {
  id: 'rtu-tubs', version: 1, name: 'Ready-to-use nested containers (tubs)', checker: true,
  instruction: 'Check the supplier\'s certificate, decontaminate the outer bags, peel the lids in grade A and count the tubs.',
  fields: [{ name: 'lot', label: 'Container lot', kind: 'lot' }, yes('certificate', 'Certificate: sterile, siliconised, this lot'), num('received', 'Tubs received', 'units'),
    { name: 'decon', label: 'Outer bag decontamination', kind: 'choice', options: ['e-beam', 'VHP'] }, yes('peeled', 'Lids peeled in grade A'), num('used', 'Tubs used', 'units')],
  settings: [],
  calcs: [observe('ready', 'Certificate checked, lids peeled in grade A', ['certificate', 'peeled'])],
};

// 33b. Pre-sterilised empty bags in sealed carriers: a pressure-decay test per carrier.
export const rtuBags: Block = {
  id: 'rtu-bags', version: 1, name: 'Pre-sterilised empty bags in sealed carriers', checker: true,
  instruction: 'Check each carrier with the pressure-decay test, then pass the carriers in by the UV tunnel.',
  fields: [{ name: 'lot', label: 'Bag lot', kind: 'lot' }, num('carriers', 'Carriers', 'units'), { name: 'decay', label: 'Pressure decay per carrier', kind: 'number', unit: 'mbar', count: '$carrierCount' }],
  settings: [{ name: 'carrierCount', label: 'Carriers per batch', kind: 'number' }, limit('decayLimit', 'Pressure decay limit', false)],
  calcs: [{ name: 'decayCheck', label: 'Every carrier tight', template: 'C3', args: { readings: '$decay', band: { limit: '$decayLimit' } } }],
};

// 34. Plunger stopper and bubble check, periodically.
export const plungerCheck: Block = {
  id: 'plunger-check', version: 1, name: 'Plunger and bubble check', checker: false, periodic: { maxMinutes: 1440 }, stop: 'done',
  instruction: 'At each round measure the plunger position and bubble size of the units shown and look for stopper defects.',
  fields: [{ name: 'position', label: 'Plunger position per unit', kind: 'number', unit: 'mm', count: '$units' }, num('bubble', 'Largest bubble', 'mm'), yes('noDefects', 'No stopper defects'), going('filling', 'Filling')],
  settings: [{ name: 'units', label: 'Units per round', kind: 'number' }, limit('positionLimit', 'Plunger position limits', false), limit('bubbleLimit', 'Bubble size limit')],
  calcs: [{ name: 'positionCheck', label: 'Every plunger position', template: 'C3', args: { readings: '$position', band: { limit: '$positionLimit' } } },
    within('bubbleCheck', 'Bubble size', 'bubble', 'bubbleLimit?'), observe('defectCheck', 'No stopper defects', ['noDefects']), finished('filling', 'Filling')],
};

// ---- 4.6 Bags and bottles

// 35. Form-fill-seal or blow-fill-seal run: fill weights per round (net from the mean empty container when it has no tare).
export const ffsRun: Block = {
  id: 'ffs-run', version: 1, name: 'Form-fill-seal or blow-fill-seal run', checker: false, periodic: { maxMinutes: 1440 }, stop: 'done',
  instruction: 'At each round weigh the units shown, check seals and ports, leak check the samples and read the counter.',
  fields: [
    { name: 'machine', label: 'FFS or BFS machine', kind: 'machine', types: ['form', 'blow', 'bfs', 'ffs'], notTypes: ['platform', 'balance'] },
    { name: 'weights', label: 'Net fill weight per unit', kind: 'number', unit: 'g', count: '$units' }, yes('seals', 'Seals and ports as specified'), yes('leak', 'Leak check of samples passed'),
    num('counter', 'Counter', 'units'), going('filling', 'Filling'),
  ],
  settings: [{ name: 'units', label: 'Units per round', kind: 'number' }, limit('meanLimit', 'Mean fill weight limits', false), limit('eachLimit', 'Each fill weight limits', false)],
  calcs: [{ name: 'mean', label: 'Mean fill weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'each', label: 'Each fill weight', template: 'C3', args: { readings: '$weights', band: { limit: '$eachLimit' } } },
    observe('sealCheck', 'Seals, ports and leak check', ['seals', 'leak']), finished('filling', 'Filling')],
};

// 35, version 2 (owner, 17 Nov 2026, aseptic blow-fill-seal): each round also records the parison (extrusion)
// temperature of a BFS machine (a film form-fill-seal has none), the mould or tool in use and the check of the air
// shower or blow air filter; the LVP bag filling machine is taken too. Version 1 stays for the recorded batches.
export const ffsRun2: Block = {
  ...ffsRun, version: 2,
  instruction: 'At each round read the parison temperature (BFS) and the mould or tool in use, check the air shower or blow air filter, weigh the units shown, check seals and ports, leak check the samples and read the counter.',
  fields: [
    { ...ffsRun.fields[0]!, types: ['form', 'blow', 'bfs', 'ffs', 'bag fill'] },
    num('parison', 'Parison (extrusion) temperature (BFS)', '°C', true), text('mould', 'Mould or tool ID'), yes('airFilter', 'Air shower or blow air filter checked'),
    ...ffsRun.fields.slice(1),
  ],
  settings: [...ffsRun.settings, limit('parisonLimit', 'Parison temperature limits')],
  calcs: [within('parisonCheck', 'Parison temperature', 'parison?', 'parisonLimit?'), observe('airCheck', 'Air shower or blow air filter checked', ['airFilter']), ...ffsRun.calcs],
};

// ---- 4.7 Emulsions, suspensions, depots, liposomes, lipid nanoparticles

// 36. Prepare a phase (oil, aqueous, lipid in ethanol or another solvent); materials go in with charge.
export const phasePrep: Block = {
  id: 'phase-prep', version: 1, name: 'Prepare a phase', checker: false,
  instruction: 'Prepare the phase at the temperature shown (under nitrogen where the master says) until dissolved.',
  fields: [{ name: 'machine', label: 'Vessel', kind: 'machine', types: ['vessel', 'tank'] }, num('temperature', 'Temperature', '°C'), yes('overlay', 'Nitrogen overlay (where asked)', true),
    yes('dissolved', 'Dissolved'), time('start', 'Start'), time('end', 'End')],
  settings: [{ name: 'phase', label: 'Phase', kind: 'text', options: ['oil phase', 'aqueous phase', 'lipid in ethanol', 'lipid in another solvent'] }, limit('temperatureLimit', 'Temperature limits')],
  calcs: [within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), observe('dissolvedCheck', 'Dissolved', ['dissolved']), duration('time', 'Time', 'start', 'end', '')],
};

// 37. Disperse, homogenise, mill or extrude: passes until the size check passes or the passes run out.
export const homogenise: Block = {
  id: 'homogenise', version: 1, name: 'Disperse, homogenise, mill or extrude', checker: false,
  instruction: 'Run one pass (or period) at the settings shown and record pressure or speed, temperatures and time.',
  fields: [{ name: 'machine', label: 'Homogeniser, mill or extruder', kind: 'machine', types: ['homogen', 'mill', 'extrud', 'microfluid', 'mixer', 'shear'] },
    num('pressure', 'Pressure', 'bar', true), num('speed', 'Speed', 'rpm', true), num('outlet', 'Outlet temperature', '°C', true), time('start', 'Start'), time('end', 'End')],
  settings: [limit('pressureLimit', 'Pressure limits'), limit('speedLimit', 'Speed limits'), limit('outletLimit', 'Outlet temperature limits')],
  calcs: [within('pressureCheck', 'Pressure', 'pressure?', 'pressureLimit?'), within('speedCheck', 'Speed', 'speed?', 'speedLimit?'), within('outletCheck', 'Outlet temperature', 'outlet?', 'outletLimit?'),
    duration('time', 'Time of this run', 'start', 'end', '')],
};

// 38. Particle, droplet or vesicle size; the stop check of homogenise (master: repeat until).
export const sizeCheck: Block = {
  id: 'size-check', version: 1, name: 'Particle, droplet or vesicle size', checker: false, stop: 'sizeOk',
  instruction: 'Measure the size as the master says (d50/d90 or Z-average and PDI, PFAT5).',
  fields: [num('size', 'd50 or Z-average', 'nm'), num('d90', 'd90', 'nm', true), num('pdi', 'PDI', 'index', true), num('pfat5', 'PFAT5 (% fat > 5 µm)', '%', true)],
  settings: [limit('sizeLimit', 'Size limits', false), limit('d90Limit', 'd90 limit'), limit('pdiLimit', 'PDI limit'), limit('pfat5Limit', 'PFAT5 limit')],
  calcs: [within('sizeOk', 'Size', 'size', 'sizeLimit'), within('d90Check', 'd90', 'd90?', 'd90Limit?'), within('pdiCheck', 'PDI', 'pdi?', 'pdiLimit?'), within('pfat5Check', 'PFAT5', 'pfat5?', 'pfat5Limit?')],
};

// 39. Harden and remove solvent (microspheres): stirred, then washed; the variants below for evaporation and spray drying.
export const harden: Block = {
  id: 'harden', version: 1, name: 'Harden and remove solvent', checker: false,
  instruction: 'Harden at the temperature and stirring shown for the time shown, then wash as the master says.',
  fields: [time('start', 'Start'), time('end', 'End'), num('temperature', 'Temperature', '°C'), num('speed', 'Stirring speed', 'rpm', true), num('washes', 'Wash rounds', 'units', true)],
  settings: [limit('timeLimit', 'Hardening time limits', false), limit('temperatureLimit', 'Temperature limits')],
  calcs: [duration('time', 'Hardening time', 'start', 'end', 'timeLimit'), within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?')],
};

// 39b. Vacuum evaporation to a dry film (or a residual-solvent end point), round by round.
export const evaporate: Block = {
  id: 'evaporate', version: 1, name: 'Remove solvent by vacuum evaporation', checker: false, stop: 'endPoint',
  instruction: 'At each reading record the absolute pressure and bath temperature; stop at a dry film (or the residual solvent shown).',
  fields: [num('pressure', 'Absolute pressure', 'mbar'), num('bath', 'Bath temperature', '°C'), yes('dry', 'Dry film (end point)')],
  settings: [limit('pressureLimit', 'Pressure limits'), limit('bathLimit', 'Bath temperature limits')],
  calcs: [within('pressureCheck', 'Pressure', 'pressure', 'pressureLimit?'), within('bathCheck', 'Bath temperature', 'bath', 'bathLimit?'), observe('endPoint', 'Dry film', ['dry'])],
};

// 39c. Spray drying: inlet/outlet temperature, feed and gas per reading; free-flowing powder, residual solvent, yield.
export const sprayDry: Block = {
  id: 'spray-dry', version: 1, name: 'Spray dry', checker: true,
  instruction: 'Record the inlet and outlet temperatures, feed rate and atomising gas; at the end weigh the powder and test residual solvent and loss on drying.',
  fields: [num('inlet', 'Inlet temperature', '°C'), num('outlet', 'Outlet temperature', '°C'), num('feed', 'Feed rate', 'mL/min'), num('gas', 'Atomising gas', 'L/min'),
    yes('freeFlowing', 'Free-flowing powder'), num('solvent', 'Residual solvent', 'ppm', true), num('lod', 'Loss on drying', '%', true), num('powder', 'Powder collected', 'kg')],
  settings: [limit('inletLimit', 'Inlet temperature limits'), limit('outletLimit', 'Outlet temperature limits'), limit('solventLimit', 'Residual solvent limit'), limit('lodLimit', 'Loss on drying limit'),
    { name: 'theoretical', label: 'Theoretical powder', kind: 'quantity' }, limit('yieldLimit', 'Yield limits')],
  calcs: [within('inletCheck', 'Inlet temperature', 'inlet', 'inletLimit?'), within('outletCheck', 'Outlet temperature', 'outlet', 'outletLimit?'), observe('flowCheck', 'Free-flowing', ['freeFlowing']),
    within('solventCheck', 'Residual solvent', 'solvent?', 'solventLimit?'), within('lodCheck', 'Loss on drying', 'lod?', 'lodLimit?'),
    { name: 'yield', label: 'Spray-drying yield', template: 'T3', args: { actual: '$powder', theoretical: '$theoretical', limit: '$yieldLimit?' } }],
};

// 40. Tangential flow filtration: diafiltration rounds until the diavolumes are reached.
export const tff: Block = {
  id: 'tff', version: 1, name: 'Tangential flow filtration', checker: false, stop: 'diavolumes',
  instruction: 'At each round record the permeate collected, transmembrane pressure and temperature; go on until the diavolumes are reached.',
  fields: [num('retentate', 'Retentate volume', 'L'), num('permeate', 'Permeate collected so far', 'L'), num('tmp', 'Transmembrane pressure', 'bar'), num('temperature', 'Temperature', '°C'),
    num('endValue', 'Ethanol or conductivity at the end', '$endUnit', true)],
  settings: [limit('diavolumeLimit', 'Diavolumes to reach', false), limit('tmpLimit', 'TMP limits'), { name: 'endUnit', label: 'End value unit', kind: 'text', options: ['%v/v', 'µS/cm', 'mS/cm'] }, limit('endLimit', 'End value limit')],
  calcs: [{ name: 'diavolumes', label: 'Diavolumes', template: 'T6', args: { mode: 'ratio', a: '$permeate', b: '$retentate', limit: '$diavolumeLimit' } },
    within('tmpCheck', 'TMP', 'tmp', 'tmpLimit?'), within('endCheck', 'End value', 'endValue?', 'endLimit?')],
};

// 41. Incubate, crystallise, hold or freeze at a set temperature (the purpose names the step).
export const incubate: Block = {
  id: 'incubate', version: 1, name: 'Incubate, crystallise, hold or freeze at a set temperature', checker: false,
  instruction: 'Keep the product at the temperature shown for the time shown and record the extent where the master asks.',
  fields: [time('start', 'Start'), time('end', 'End'), num('temperature', 'Temperature (product, for a freeze)', '°C'), num('ph', 'pH', 'pH', true), num('extent', 'Extent (encapsulated or adsorbed)', '%', true)],
  settings: [{ name: 'purpose', label: 'Purpose', kind: 'text', options: ['load, adsorb or conjugate', 'crystallise', 'hold filled units before inspection', 'freeze'] },
    limit('timeLimit', 'Time limits', false), limit('temperatureLimit', 'Temperature limits', false), limit('extentLimit', 'Extent limits')],
  calcs: [duration('time', 'Time', 'start', 'end', 'timeLimit'), within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit'), within('extentCheck', 'Extent', 'extent?', 'extentLimit?')],
};

// 42. Column step (ion exchange or gel filtration): fractions as rounds, pooled by the master's criterion.
export const column: Block = {
  id: 'column', version: 1, name: 'Column step (ion exchange or gel filtration)', checker: true, stop: 'last',
  instruction: 'Collect each fraction; record its volume and conductivity (or UV) and whether it is pooled by the master\'s criterion.',
  fields: [num('volume', 'Fraction volume', 'mL'), num('conductivity', 'Conductivity', 'mS/cm'), yes('pooled', 'Pooled by the master\'s criterion'),
    { name: 'fractions', label: 'Fractions', kind: 'choice', options: ['more to come', 'last fraction'] }],
  settings: [{ name: 'kind', label: 'Column', kind: 'text', options: ['ion exchange', 'gel filtration'] }, limit('conductivityLimit', 'Conductivity of pooled fractions')],
  calcs: [within('conductivityCheck', 'Conductivity', 'conductivity', 'conductivityLimit?'),
    { name: 'last', label: 'Last fraction', template: 'C4', args: { question: 'Fractions', answers: ['$fractions'], expected: ['last fraction'], options: ['more to come', 'last fraction'] } }],
};

// ---- 4.8 Dual-chamber and multi-chamber

// 43. Seal between chambers, periodically.
export const chamberSeal: Block = {
  id: 'chamber-seal', version: 1, name: 'Seal between chambers', checker: false, periodic: { maxMinutes: 1440 }, stop: 'done',
  instruction: 'At each round check the middle stopper and bypass position (or the peel seal strength) of the units shown.',
  fields: [{ name: 'readings', label: 'Position or peel strength per unit', kind: 'number', unit: '$unit', count: '$units' }, yes('visual', 'Visual as specified'), going('filling', 'Filling')],
  settings: [{ name: 'units', label: 'Units per round', kind: 'number' }, { name: 'unit', label: 'Unit', kind: 'text', options: ['mm', 'N'] }, limit('readingLimit', 'Limits', false)],
  calcs: [{ name: 'each', label: 'Every unit', template: 'C3', args: { readings: '$readings', band: { limit: '$readingLimit' } } }, observe('visualCheck', 'Visual', ['visual']), finished('filling', 'Filling')],
};
