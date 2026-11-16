import type { Block } from './format.js';

// TrueBatch Injectables library v1, section 4.2: dispensing, compounding, filtration, components, filling, sterilisation
// and inspection. Each block is data; the engine runs it. Where a library "setting" changes which fields are needed, the
// block has a variant of its own (a plain, distinct name), never a conditional field.

const yes = (name: string, label: string) => ({ name, label, kind: 'yes-no' as const });
const time = (name: string, label: string) => ({ name, label, kind: 'timer' as const });
const num = (name: string, label: string, unit: string, optional = false) => ({ name, label, kind: 'number' as const, unit, ...(optional ? { optional: true } : {}) });
const text = (name: string, label: string, optional = false) => ({ name, label, kind: 'text' as const, ...(optional ? { optional: true } : {}) });
const limit = (name: string, label: string, optional = true) => ({ name, label, kind: 'limit' as const, ...(optional ? { optional: true } : {}) });
const within = (name: string, label: string, value: string, lim: string) => ({ name, label, template: 'C1', args: { value: `$${value}`, limit: `$${lim}` } });
const observe = (name: string, label: string, answers: string[]) => ({ name, label, template: 'C4', args: { question: label, answers: answers.map((a) => `$${a}`), expected: ['yes'] } });
const duration = (name: string, label: string, start: string, end: string, lim: string) => ({ name, label, template: 'T13', args: { mode: 'duration', start: `$${start}`, end: `$${end}`, limit: `$${lim}` } });

// 1. Thaw and pool drug substance: the containers of a lot with their concentration from the certificate.
export const dsThawPool: Block = {
  id: 'ds-thaw-pool', version: 1, name: 'Thaw and pool drug substance', checker: true,
  instruction: 'Thaw the drug substance containers as the master says (a refrigerated bulk is not thawed), weigh each container and pool them.',
  fields: [
    { name: 'lot', label: 'Drug substance lot', kind: 'lot' },
    num('containers', 'Containers pooled', 'units'),
    num('net', 'Net weight of each container', 'kg'),
    time('thawStart', 'Thaw start'), time('thawEnd', 'Thaw end'),
    num('thawTemp', 'Thaw temperature', '°C', true),
    num('concentration', 'Concentration (certificate)', 'mg/mL'),
    num('density', 'Density (certificate or measured)', 'g/mL', true),
  ],
  settings: [limit('thawTimeLimit', 'Thaw time limits'), limit('thawTempLimit', 'Thaw temperature limits'), limit('concentrationLimit', 'Concentration limits')],
  calcs: [
    { name: 'pooled', label: 'Drug substance pooled', template: 'T2', args: { values: '$net' } },
    duration('thawTime', 'Thaw time', 'thawStart', 'thawEnd', 'thawTimeLimit?'),
    within('thawTempCheck', 'Thaw temperature', 'thawTemp?', 'thawTempLimit?'),
    within('concentrationCheck', 'Concentration', 'concentration', 'concentrationLimit?'),
  ],
};

// 2. Collect the vehicle (water for injections or a buffer) from its point of use, by weight or flowmeter.
export const vehicle: Block = {
  id: 'vehicle', version: 1, name: 'Collect the vehicle (WFI or buffer)', checker: true,
  instruction: 'Collect the vehicle from the point of use shown into the vessel; record its temperature and quantity.',
  fields: [
    text('source', 'Point of use or lot'),
    num('temperature', 'Temperature', '°C'),
    num('quantity', 'Quantity collected', 'kg'),
    yes('treated', 'Cooled or nitrogen-sparged as the master says'),
  ],
  settings: [limit('temperatureLimit', 'Temperature limits'), limit('quantityLimit', 'Quantity limits')],
  calcs: [
    within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'),
    within('quantityCheck', 'Quantity', 'quantity', 'quantityLimit?'),
    observe('treatedCheck', 'Cooled or sparged as the master says', ['treated']),
  ],
};

// 3. Mix until dissolved (minimum time by the master step's minMinutes).
export const dissolve: Block = {
  id: 'dissolve', version: 1, name: 'Mix until dissolved', checker: false,
  instruction: 'Add the material, mix at the speed shown until it has dissolved, and look at the solution.',
  fields: [
    { name: 'machine', label: 'Vessel or mixer', kind: 'machine', types: ['vessel', 'mix', 'stirrer', 'tank'] },
    num('speed', 'Speed', 'rpm', true), num('temperature', 'Temperature', '°C', true),
    time('start', 'Start'), time('end', 'End'),
    yes('clear', 'Solution clear, everything dissolved'),
  ],
  settings: [limit('speedLimit', 'Speed limits'), limit('temperatureLimit', 'Temperature limits'), limit('timeLimit', 'Mixing time limits')],
  calcs: [
    within('speedCheck', 'Speed', 'speed?', 'speedLimit?'),
    within('temperatureCheck', 'Temperature', 'temperature?', 'temperatureLimit?'),
    duration('mixTime', 'Mixing time', 'start', 'end', 'timeLimit?'),
    observe('clearCheck', 'Solution clear', ['clear']),
  ],
};

// 4. Adjust the pH, round by round, until it is inside its window; the total added is checked against its maximum.
export const phAdjust: Block = {
  id: 'ph-adjust', version: 1, name: 'Adjust the pH', checker: false, stop: 'phCheck',
  instruction: 'Measure the pH; if it is outside the window, add the adjusting solution, mix and measure again.',
  fields: [
    num('ph', 'pH', 'pH'), num('temperature', 'Temperature', '°C'),
    { name: 'solution', label: 'Adjusting solution', kind: 'choice', options: ['none', 'sodium hydroxide', 'hydrochloric acid', 'other (named in the master)'] },
    num('added', 'Volume added this round', 'mL'),
  ],
  settings: [limit('phLimit', 'pH window', false), limit('totalLimit', 'Most adjusting solution in total')],
  calcs: [
    within('phCheck', 'pH', 'ph', 'phLimit'),
    { name: 'total', label: 'Adjusting solution added so far', template: 'T2', args: { values: ['$prev.total?', '$added'], limit: '$totalLimit?' } },
  ],
};

// 4b. A treatment loop that stops on an observation (activated carbon added per round until no particles are seen).
export const treatUntilClear: Block = {
  id: 'treat-until-clear', version: 1, name: 'Treat until clear (e.g. activated carbon)', checker: false, stop: 'clearCheck',
  instruction: 'Add the treatment of this round, mix and look at the solution; repeat until it is clear of particles.',
  fields: [num('added', 'Added this round', 'g'), yes('clear', 'No particles seen')],
  settings: [limit('totalLimit', 'Most added in total')],
  calcs: [
    observe('clearCheck', 'No particles', ['clear']),
    { name: 'total', label: 'Added so far', template: 'T2', args: { values: ['$prev.total?', '$added'], limit: '$totalLimit?' } },
  ],
};

// 5. Make up to the final volume or weight (q.s. with the vehicle).
export const makeUp: Block = {
  id: 'make-up', version: 1, name: 'Make up to final volume or weight', checker: true,
  instruction: 'Add the vehicle to the final weight shown (or the level for the volume), mix for the time shown and record the reading.',
  fields: [
    { name: 'machine', label: 'Vessel', kind: 'machine', types: ['vessel', 'tank'] },
    num('gross', 'Vessel gross weight', 'kg'), num('tare', 'Vessel tare weight', 'kg'),
    num('temperature', 'Temperature', '°C'),
    time('mixStart', 'Mixing start'), time('mixEnd', 'Mixing end'),
  ],
  settings: [
    { name: 'volume', label: 'Final batch volume', kind: 'quantity' }, { name: 'density', label: 'Density at the make-up temperature', kind: 'quantity' },
    { name: 'tolerance', label: 'Tolerance on the batch weight (± %)', kind: 'number' }, limit('temperatureLimit', 'Temperature limits'), limit('mixTimeLimit', 'Mixing time limits'),
  ],
  calcs: [
    { name: 'target', label: 'Target batch weight', template: 'I18', args: { mode: 'convert', quantity: '$volume', density: '$density', unit: 'kg', decimals: 3 } },
    { name: 'net', label: 'Batch weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Batch weight against the target', template: 'C1', args: { value: '$net', around: { centre: '$target', name: 'target batch weight', plusMinusPercent: '$tolerance' } } },
    within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'),
    duration('mixTime', 'Mixing time', 'mixStart', 'mixEnd', 'mixTimeLimit?'),
  ],
};

// 6. In-process bulk test, held for QC's result (a QA hold).
export const bulkTest: Block = {
  id: 'bulk-test', version: 1, name: 'In-process bulk test (hold)', checker: true, qaHold: true,
  instruction: 'Take the bulk sample, send it to QC and record the results when they come. Wait for QA to release the hold.',
  fields: [
    text('reference', 'Sample reference'),
    num('ph', 'pH', 'pH', true), num('density', 'Density', 'g/mL', true), num('assay', 'Assay (% of target)', '%', true),
    num('osmolality', 'Osmolality', 'mOsm/kg', true), num('oxygen', 'Dissolved oxygen', 'mg/L', true), num('solvent', 'Residual solvent', 'ppm', true),
    yes('appearance', 'Appearance as specified'),
  ],
  settings: [limit('phLimit', 'pH limits'), limit('densityLimit', 'Density limits'), limit('assayLimit', 'Assay limits'), limit('osmolalityLimit', 'Osmolality limits'),
    limit('oxygenLimit', 'Dissolved oxygen limit'), limit('solventLimit', 'Residual solvent limit')],
  calcs: [
    within('phCheck', 'pH', 'ph?', 'phLimit?'), within('densityCheck', 'Density', 'density?', 'densityLimit?'), within('assayCheck', 'Assay', 'assay?', 'assayLimit?'),
    within('osmolalityCheck', 'Osmolality', 'osmolality?', 'osmolalityLimit?'), within('oxygenCheck', 'Dissolved oxygen', 'oxygen?', 'oxygenLimit?'),
    within('solventCheck', 'Residual solvent', 'solvent?', 'solventLimit?'),
    observe('appearanceCheck', 'Appearance', ['appearance']),
  ],
};

// 7. Correct the bulk concentration: the vehicle (or a concentrated donor) to add, worked out from the measured value.
export const bulkAdjust: Block = {
  id: 'bulk-adjust', version: 1, name: 'Correct the bulk concentration', checker: true,
  instruction: 'From the measured concentration, add the quantity worked out, mix and record it.',
  fields: [num('measured', 'Measured concentration', 'mg/mL'), num('bulk', 'Bulk quantity in the vessel', 'kg'), num('added', 'Quantity added', 'kg')],
  settings: [
    { name: 'target', label: 'Target concentration', kind: 'quantity' },
    { name: 'donor', label: 'Concentration of what is added (0 for the vehicle)', kind: 'quantity' },
    { name: 'direction', label: 'Direction', kind: 'text', options: ['dilute with the vehicle', 'raise with a concentrated donor'] },
    limit('largestLimit', 'Largest correction allowed'), { name: 'tolerance', label: 'Tolerance on the quantity added (± %)', kind: 'number' },
  ],
  calcs: [
    { name: 'toAdd', label: 'Quantity to add', template: 'T26', args: { mass: '$bulk', a: '$measured', b: '$donor', target: '$target', property: 'concentration', limit: '$largestLimit?' } },
    { name: 'addedCheck', label: 'Added against the quantity worked out', template: 'C1', args: { value: '$added', around: { centre: '$toAdd', name: 'quantity to add', plusMinusPercent: '$tolerance' } } },
  ],
};

// 8. Inert gas sparge, flush or overlay, repeated until the oxygen is at or below its limit.
export const nitrogen: Block = {
  id: 'nitrogen', version: 1, name: 'Inert gas sparge, flush or overlay', checker: false, stop: 'oxygenCheck',
  instruction: 'Sparge, flush or overlay with the gas and at the points shown; measure the oxygen.',
  fields: [
    text('gasFilter', 'Gas filter ID'), time('start', 'Start'), time('end', 'End'), num('flow', 'Gas flow', 'L/min', true),
    num('oxygen', 'Oxygen (dissolved mg/L, or headspace % v/v)', '$oxygenUnit'),
  ],
  settings: [
    { name: 'gas', label: 'Gas', kind: 'text', options: ['nitrogen', 'argon', 'carbon dioxide', 'perflutren'] },
    { name: 'points', label: 'Points', kind: 'text', options: ['bulk sparge', 'container before filling', 'headspace after filling or at stoppering', 'several (named in the instruction)'] },
    { name: 'oxygenUnit', label: 'Oxygen unit', kind: 'text', options: ['mg/L', '%v/v'] },
    limit('oxygenLimit', 'Oxygen limit', false), limit('timeLimit', 'Time limits'),
  ],
  calcs: [
    within('oxygenCheck', 'Oxygen', 'oxygen', 'oxygenLimit'),
    duration('time', 'Sparge time', 'start', 'end', 'timeLimit?'),
  ],
};

// 8b. Solvent stripping with a gas: staged flows, stopped on a residual-solvent result.
export const solventStrip: Block = {
  id: 'solvent-strip', version: 1, name: 'Strip a solvent with a gas (staged flows)', checker: false, stop: 'solventCheck',
  instruction: 'Run this stage at the flow shown for its time, then test the residual solvent; go on with the next stage until it is inside the limit.',
  fields: [num('flow', 'Gas flow this stage', 'L/min'), time('start', 'Stage start'), time('end', 'Stage end'), num('solvent', 'Residual solvent', 'ppm')],
  settings: [limit('flowLimit', 'Flow limits'), limit('stageTimeLimit', 'Stage time limits'), limit('solventLimit', 'Residual solvent limit', false)],
  calcs: [
    within('flowCheck', 'Gas flow', 'flow', 'flowLimit?'),
    duration('stageTime', 'Stage time', 'start', 'end', 'stageTimeLimit?'),
    within('solventCheck', 'Residual solvent', 'solvent', 'solventLimit'),
  ],
};

// 9. Filter integrity test (TI-25): pre-use after sterilisation, or post-use. Re-wet and retest up to the master's rounds.
export const filterTest: Block = {
  id: 'filter-test', version: 1, name: 'Filter integrity test', checker: true, stop: 'integrity',
  instruction: 'Test the filter as the master says (test type, wetting fluid, temperature); record the tester result and its printout reference.',
  fields: [
    text('filterId', 'Filter ID'), { name: 'lot', label: 'Filter lot', kind: 'lot' },
    { name: 'when', label: 'When', kind: 'choice', options: ['pre-use after sterilisation', 'post-use'] },
    num('temperature', 'Test temperature', '°C'),
    { name: 'tester', label: 'Integrity tester', kind: 'machine', types: ['integrity', 'tester', 'filter'] },
    num('result', 'Result', '$resultUnit'),
    text('printout', 'Printout reference'),
    yes('asMaster', 'Filter type and pore size as the master'),
  ],
  settings: [
    { name: 'test', label: 'Test', kind: 'text', options: ['bubble point', 'diffusion', 'pressure decay', 'water intrusion'] },
    { name: 'resultUnit', label: 'Result unit', kind: 'text', options: ['bar g', 'mbar g', 'psi g', 'kPa g', 'kgf/cm² g', 'mL/min', 'mbar'] },
    { name: 'makerLimit', label: 'Maker\'s limit for the wetting fluid', kind: 'quantity' },
    { name: 'wettedWith', label: 'Wetted with', kind: 'text', options: ['water', 'alcohol', 'product', 'solvent'] },
    { name: 'productFactor', label: 'Product factor from validation (product or solvent wetted)', kind: 'number', optional: true },
    limit('temperatureRange', 'Test temperature range (the maker\'s)', false),
  ],
  calcs: [
    observe('filterCheck', 'Filter as the master', ['asMaster']),
    { name: 'integrity', label: 'Integrity test', template: 'I19', args: { mode: '$test', result: '$result', makerLimit: '$makerLimit', wettedWith: '$wettedWith', productFactor: '$productFactor?', temperature: '$temperature', temperatureRange: '$temperatureRange' } },
  ],
};

// 10. Sterile filtration (TI-25, TI-26): bioburden sample before the filter, the filter train, time and pressure.
export const filtration: Block = {
  id: 'filtration', version: 1, name: 'Sterile filtration', checker: true,
  instruction: 'Take the bioburden sample just before the sterilising filter, then filter the bulk into the sterilised receiving vessel.',
  fields: [
    text('bioburdenId', 'Bioburden sample ID'), time('bioburdenAt', 'Bioburden sample taken at'),
    text('filters', 'Filter train IDs'), text('vesselLoad', 'Receiving vessel: sterilisation load'),
    { name: 'vesselUseBy', label: 'Receiving vessel use-by date', kind: 'text', date: true, useBy: true },
    time('start', 'Filtration start'), time('end', 'Filtration end'),
    num('pressure', 'Highest pressure difference', 'bar'), num('filtered', 'Filtered quantity', 'kg'),
  ],
  settings: [limit('pressureLimit', 'Pressure difference limit'), limit('timeLimit', 'Filtration time limits'), limit('filteredLimit', 'Filtered quantity limits')],
  calcs: [
    duration('time', 'Filtration time', 'start', 'end', 'timeLimit?'),
    within('pressureCheck', 'Pressure difference', 'pressure', 'pressureLimit?'),
    within('filteredCheck', 'Filtered quantity', 'filtered', 'filteredLimit?'),
  ],
};

// 10b. Clarifying (non-sterilising) filtration: no integrity test, no bioburden sample, no filtered-bulk hold.
export const filtrationClarifying: Block = {
  id: 'filtration-clarifying', version: 1, name: 'Clarifying filtration (not sterilising)', checker: false,
  instruction: 'Filter the bulk through the clarifying filter shown (carbon removal, prefilter, emulsion filter, depyrogenating ultrafiltration).',
  fields: [text('filters', 'Filter IDs'), time('start', 'Start'), time('end', 'End'), num('pressure', 'Highest pressure difference', 'bar', true)],
  settings: [limit('pressureLimit', 'Pressure difference limit'), limit('timeLimit', 'Filtration time limits')],
  calcs: [duration('time', 'Filtration time', 'start', 'end', 'timeLimit?'), within('pressureCheck', 'Pressure difference', 'pressure?', 'pressureLimit?')],
};

// 11. Wash containers, stoppers or product-contact parts (siliconisation is a part of the cycle the master names).
export const componentWash: Block = {
  id: 'component-wash', version: 1, name: 'Wash containers, stoppers or parts', checker: false,
  instruction: 'Wash the components or parts in the washer; check the final rinse and look at them.',
  fields: [
    { name: 'washer', label: 'Washer', kind: 'machine', types: ['wash', 'processor'] },
    { name: 'lot', label: 'Component lot', kind: 'lot', optional: true }, num('count', 'Components or parts washed', 'units'),
    text('printout', 'Cycle printout reference'), num('conductivity', 'Final rinse conductivity', 'µS/cm', true),
    text('siliconeLot', 'Silicone emulsion lot (when siliconised)', true), yes('visual', 'Clean, no particles, not damaged'),
  ],
  settings: [
    { name: 'what', label: 'What is washed', kind: 'text', options: ['containers', 'stoppers', 'product-contact parts'] },
    limit('conductivityLimit', 'Final rinse conductivity limit'),
  ],
  calcs: [within('conductivityCheck', 'Final rinse conductivity', 'conductivity?', 'conductivityLimit?'), observe('visualCheck', 'Components clean', ['visual'])],
};

// 12. Depyrogenate containers in a tunnel or oven, with belt speed and hot-zone checks alongside the stage.
export const depyrogenate: Block = {
  id: 'depyrogenate', version: 1, name: 'Depyrogenate containers (tunnel or oven)', checker: false, periodic: { maxMinutes: 1440, alongside: true },
  instruction: 'Check the tunnel or oven at each round: hot-zone temperature, belt speed and the grade A particle count at the exit.',
  fields: [
    { name: 'machine', label: 'Tunnel or oven', kind: 'machine', types: ['tunnel', 'oven', 'dry heat'] },
    num('hotZone', 'Hot-zone temperature', '°C'), num('beltSpeed', 'Belt speed', 'mm/min', true),
    num('particles', 'Particles ≥ 0.5 µm at the exit', 'particles/m³', true), num('count', 'Containers through', 'units', true),
  ],
  settings: [limit('hotZoneLimit', 'Hot-zone temperature limits', false), limit('beltSpeedLimit', 'Belt speed limits'), limit('particleLimit', 'Particle limit at the exit')],
  calcs: [within('hotZoneCheck', 'Hot-zone temperature', 'hotZone', 'hotZoneLimit'), within('beltCheck', 'Belt speed', 'beltSpeed?', 'beltSpeedLimit?'),
    within('particleCheck', 'Particles at the exit', 'particles?', 'particleLimit?')],
};

// 13. Sterilise items (autoclave, dry heat, SIP, gas, RTU tub decontamination) (TI-24): the load and its use-by.
export const sterilise: Block = {
  id: 'sterilise', version: 1, name: 'Sterilise items or equipment', checker: true,
  instruction: 'Load as the validated load pattern, run the validated cycle, and check the printout, indicators and the load before unloading into the grade shown.',
  fields: [
    { name: 'steriliser', label: 'Steriliser', kind: 'machine', types: ['autoclave', 'steriliser', 'sterilizer', 'oven', 'sip'] },
    text('loadId', 'Load ID'), yes('pattern', 'Load pattern as validated'), text('printout', 'Cycle printout reference'),
    num('exposure', 'Time at sterilising temperature', 'min'), num('lowest', 'Lowest probe temperature in exposure', '°C'),
    yes('indicator', 'Chemical indicator passed'), text('bi', 'Biological indicator ID (result later)', true),
    yes('dryIntact', 'Load dry, wraps intact'), { name: 'useBy', label: 'Use-by date of the load', kind: 'text', date: true, useBy: true },
  ],
  settings: [
    { name: 'what', label: 'What is sterilised', kind: 'text', options: ['items and parts', 'product bulk in its own vessel'] },
    limit('exposureLimit', 'Exposure time limits', false), limit('lowestLimit', 'Lowest temperature limit', false),
  ],
  calcs: [
    within('exposureCheck', 'Exposure time', 'exposure', 'exposureLimit'), within('lowestCheck', 'Lowest probe temperature', 'lowest', 'lowestLimit'),
    observe('loadCheck', 'Load pattern, indicator, dry and intact', ['pattern', 'indicator', 'dryIntact']),
  ],
};

// 14. Fill with periodic fill-weight checks: one net weight per needle (N4), mean and every value in its band.
export const fill: Block = {
  id: 'fill', version: 1, name: 'Fill with periodic fill-weight checks', checker: false, periodic: { maxMinutes: 1440 }, stop: 'done',
  instruction: 'At each round weigh one filled unit from every needle, check the stoppers (and the stirring of a suspension), and read the counter.',
  fields: [
    { name: 'machine', label: 'Filling machine', kind: 'machine', types: ['fill', 'filler'] },
    { name: 'weights', label: 'Net fill weight per needle', kind: 'number', unit: 'g', count: '$needles' },
    yes('stoppers', 'Stoppers seated'), { name: 'stirring', label: 'Stirring on (suspension)', kind: 'yes-no', optional: true },
    num('headspace', 'Headspace oxygen', '%v/v', true), num('counter', 'Counter', 'units'),
    { name: 'filling', label: 'Filling', kind: 'choice', options: ['going on', 'finished'] },
  ],
  settings: [
    { name: 'needles', label: 'Number of filling needles', kind: 'number' },
    limit('meanLimit', 'Mean fill weight limits', false), { name: 'band', label: 'Each fill weight within (± % of the target)', kind: 'number' },
    { name: 'fillTarget', label: 'Fill target (fill + excess)', kind: 'quantity' }, { name: 'density', label: 'Density of the bulk', kind: 'quantity' },
    limit('headspaceLimit', 'Headspace oxygen limit'),
  ],
  calcs: [
    { name: 'target', label: 'Target net fill weight', template: 'I18', args: { mode: 'convert', quantity: '$fillTarget', density: '$density', unit: 'g', decimals: 3 } },
    { name: 'mean', label: 'Mean fill weight', template: 'T7', args: { readings: '$weights', limit: '$meanLimit' } },
    { name: 'each', label: 'Each needle', template: 'C3', args: { readings: '$weights', band: { plusMinusPercent: '$band', of: { target: '$target' } } } },
    observe('stopperCheck', 'Stoppers seated (and stirring on)', ['stoppers', 'stirring?']),
    within('headspaceCheck', 'Headspace oxygen', 'headspace?', 'headspaceLimit?'),
    { name: 'done', label: 'Filling finished', template: 'C4', args: { question: 'Filling', answers: ['$filling'], expected: ['finished'], options: ['going on', 'finished'] } },
  ],
};

// 15. Close and check the seal, periodically.
export const sealCheck: Block = {
  id: 'seal-check', version: 1, name: 'Close and check the seal', checker: false, periodic: { maxMinutes: 1440 }, stop: 'done',
  instruction: 'At each round check the units shown for the seal; record defects and, where the master asks, seal force or removal torque.',
  fields: [
    { name: 'closure', label: 'Closure', kind: 'choice', options: ['crimp cap', 'screw cap', 'ampoule tip', 'overpouch', 'port cap', 'cartridge crimp', 'heat-sealed port channel'] },
    { name: 'lot', label: 'Closure lot', kind: 'lot', optional: true }, num('checked', 'Units checked', 'units'), num('defects', 'Defective units', 'units'),
    num('force', 'Seal force or removal torque', '$forceUnit', true),
    { name: 'sealing', label: 'Sealing', kind: 'choice', options: ['going on', 'finished'] },
  ],
  settings: [limit('defectLimit', 'Defective units allowed per round', false), { name: 'forceUnit', label: 'Force unit', kind: 'text', options: ['N', 'N·m'] }, limit('forceLimit', 'Seal force limits')],
  calcs: [
    within('defectCheck', 'Defective units', 'defects', 'defectLimit'), within('forceCheck', 'Seal force', 'force?', 'forceLimit?'),
    { name: 'done', label: 'Sealing finished', template: 'C4', args: { question: 'Sealing', answers: ['$sealing'], expected: ['finished'], options: ['going on', 'finished'] } },
  ],
};

// 16. Terminal sterilisation (TI-24): one round per load; the lowest probe reaches the validated minimum F0 (or FH).
export const terminalSterilise: Block = {
  id: 'terminal-sterilise', version: 1, name: 'Terminal sterilisation (each load)', checker: true,
  instruction: 'Load as validated, run the validated cycle, check the printout and the indicators; keep sterilised and unsterilised units apart.',
  fields: [
    { name: 'steriliser', label: 'Steriliser', kind: 'machine', types: ['autoclave', 'steriliser', 'sterilizer', 'oven'] },
    text('loadNo', 'Load number'), num('units', 'Units in the load', 'units'), yes('pattern', 'Load pattern as validated'), text('printout', 'Printout reference'),
    num('lowestF', 'Lowest probe lethality (printout)', 'F-min'), num('exposure', 'Exposure time', 'min'), num('maxProduct', 'Highest product temperature', '°C'),
    yes('indicators', 'Indicators passed'), yes('apart', 'Sterilised and unsterilised kept apart'), text('bi', 'Biological indicator ID (result later)', true),
  ],
  settings: [
    { name: 'medium', label: 'Medium', kind: 'text', options: ['moist heat', 'dry heat (sealed ampoules)'] },
    limit('lethalityLimit', 'Minimum lethality (validated F0 or FH)', false), limit('exposureLimit', 'Exposure time limits'), limit('maxProductLimit', 'Highest product temperature'),
  ],
  calcs: [
    within('lethality', 'Lowest probe lethality', 'lowestF', 'lethalityLimit'), within('exposureCheck', 'Exposure time', 'exposure', 'exposureLimit?'),
    within('maxProductCheck', 'Highest product temperature', 'maxProduct', 'maxProductLimit?'),
    observe('loadCheck', 'Load pattern, indicators, kept apart', ['pattern', 'indicators', 'apart']),
  ],
};

// 16b. A heat step below sterilising lethality (post-aseptic heat treatment, pasteurisation): no F0 minimum; it never
// counts as terminal sterilisation and keeps the aseptic route (master check 42).
export const heatTreatment: Block = {
  id: 'heat-treatment', version: 1, name: 'Heat treatment or pasteurisation (not sterilisation)', checker: true,
  instruction: 'Run the validated heat treatment; check time at temperature and the product temperature.',
  fields: [
    { name: 'machine', label: 'Autoclave, oven or bath', kind: 'machine', types: ['autoclave', 'oven', 'bath', 'steriliser'] },
    text('loadNo', 'Load number'), num('units', 'Units', 'units'), num('temperature', 'Lowest product temperature', '°C'), num('time', 'Time at temperature', 'min'), text('printout', 'Printout reference'),
  ],
  settings: [
    { name: 'purpose', label: 'Purpose', kind: 'text', options: ['post-aseptic heat treatment', 'pasteurisation'] },
    limit('temperatureLimit', 'Temperature limits', false), limit('timeLimit', 'Time at temperature limits', false),
  ],
  calcs: [within('temperatureCheck', 'Product temperature', 'temperature', 'temperatureLimit'), within('timeCheck', 'Time at temperature', 'time', 'timeLimit')],
};

// 17. Irradiation at a contractor: the certificate's doses per box, against the validated sterilising dose (QA hold).
export const irradiation: Block = {
  id: 'irradiation', version: 1, name: 'Irradiation at a contractor (hold)', checker: true, qaHold: true,
  instruction: 'Send the boxes; when they come back, record the certificate\'s minimum and maximum dose per box and the units back. Wait for QA.',
  fields: [
    num('boxes', 'Boxes sent', 'units'), num('unitsSent', 'Units sent', 'units'), text('certificate', 'Irradiation certificate no.'),
    { name: 'minDose', label: 'Minimum dose per box', kind: 'number', unit: 'kGy', count: '$boxCount' },
    { name: 'maxDose', label: 'Maximum dose per box', kind: 'number', unit: 'kGy', count: '$boxCount' },
    yes('indicator', 'Irradiation indicator changed'), num('unitsBack', 'Units back', 'units'),
  ],
  settings: [{ name: 'boxCount', label: 'Boxes per batch', kind: 'number' }, limit('minDoseLimit', 'Validated minimum sterilising dose', false), limit('maxDoseLimit', 'Maximum dose allowed', false)],
  calcs: [
    { name: 'minCheck', label: 'Every box at or above the minimum dose', template: 'C3', args: { readings: '$minDose', band: { limit: '$minDoseLimit' } } },
    { name: 'maxCheck', label: 'Every box at or below the maximum dose', template: 'C3', args: { readings: '$maxDose', band: { limit: '$maxDoseLimit' } } },
    observe('indicatorCheck', 'Indicator changed', ['indicator']),
    { name: 'unitsCheck', label: 'Units back', template: 'T4', args: { input: '$unitsSent', parts: [{ name: 'back', value: '$unitsBack' }] } },
  ],
};

// 18. 100 % container-closure integrity test (TI-29): standards before and after, rejects by category.
export const leakTest100: Block = {
  id: 'leak-test-100', version: 1, name: '100 % container-closure integrity test', checker: false,
  instruction: 'Challenge the machine with the positive and negative standards before and after; test every unit and record the rejects.',
  fields: [
    { name: 'machine', label: 'Leak tester (HVLD, vacuum decay, dye, laser)', kind: 'machine', types: ['leak', 'integrity', 'hvld', 'inspection'] },
    yes('standardsBefore', 'Standards passed before'), yes('standardsAfter', 'Standards passed after'),
    num('tested', 'Units tested', 'units'), num('rejected', 'Units rejected', 'units'), num('passed', 'Units passed', 'units'),
  ],
  settings: [limit('rejectLimit', 'Rejects allowed (% of units tested)')],
  calcs: [
    observe('standardsCheck', 'Standards before and after', ['standardsBefore', 'standardsAfter']),
    { name: 'balance', label: 'Units tested, accounted for', template: 'T4', args: { input: '$tested', parts: [{ name: 'passed', value: '$passed' }, { name: 'rejected', value: '$rejected' }], limit: { low: '100.0', high: '100.0', unit: '%' } } },
    { name: 'rejectRate', label: 'Reject rate', template: 'T3', args: { actual: '$rejected', theoretical: '$tested', limit: '$rejectLimit?' } },
  ],
};

// 18b. 100 % headspace gas check (laser or infrared): the named gas at or above its minimum.
export const headspaceGas: Block = {
  id: 'headspace-gas', version: 1, name: '100 % headspace gas check', checker: false,
  instruction: 'Challenge the analyser with its standards; check every unit\'s headspace gas and record the rejects.',
  fields: [
    { name: 'machine', label: 'Headspace analyser', kind: 'machine', types: ['headspace', 'laser', 'inspection'] },
    yes('standards', 'Standards passed before and after'), num('tested', 'Units tested', 'units'), num('rejected', 'Units rejected', 'units'), num('passed', 'Units passed', 'units'),
  ],
  settings: [{ name: 'gas', label: 'Gas', kind: 'text', options: ['nitrogen', 'argon', 'carbon dioxide', 'perflutren'] }, limit('rejectLimit', 'Rejects allowed (% of units tested)')],
  calcs: [
    observe('standardsCheck', 'Standards before and after', ['standards']),
    { name: 'balance', label: 'Units tested, accounted for', template: 'T4', args: { input: '$tested', parts: [{ name: 'passed', value: '$passed' }, { name: 'rejected', value: '$rejected' }], limit: { low: '100.0', high: '100.0', unit: '%' } } },
    { name: 'rejectRate', label: 'Reject rate', template: 'T3', args: { actual: '$rejected', theoretical: '$tested', limit: '$rejectLimit?' } },
  ],
};

// 19. 100 % visual inspection (TI-30): rejects by category with their limits; units in = out + rejects + samples.
export const visualInspect: Block = {
  id: 'visual-inspect', version: 1, name: '100 % visual inspection', checker: true,
  instruction: 'Inspect every unit (qualified inspector or challenged machine); record the rejects per defect category.',
  fields: [
    yes('qualified', 'Inspector qualified, or machine challenged with the kit'), num('unitsIn', 'Units in', 'units'),
    num('particles', 'Rejects: particles', 'units'), num('glass', 'Rejects: glass or container defects', 'units'), num('fillLevel', 'Rejects: fill level', 'units'),
    num('closure', 'Rejects: closure', 'units'), num('other', 'Rejects: other', 'units'), num('samples', 'Samples', 'units'), num('unitsOut', 'Good units out', 'units'),
  ],
  settings: [limit('rejectLimit', 'All rejects allowed (% of units in)'), limit('particleLimit', 'Particle rejects allowed (% of units in)')],
  calcs: [
    observe('qualifiedCheck', 'Inspector qualified or machine challenged', ['qualified']),
    { name: 'balance', label: 'Units in, accounted for', template: 'T4', args: { input: '$unitsIn', parts: [{ name: 'good', value: '$unitsOut' }, { name: 'particles', value: '$particles' }, { name: 'glass', value: '$glass' }, { name: 'fill level', value: '$fillLevel' }, { name: 'closure', value: '$closure' }, { name: 'other', value: '$other' }, { name: 'samples', value: '$samples' }], limit: { low: '100.0', high: '100.0', unit: '%' } } },
    { name: 'particleRate', label: 'Particle rejects', template: 'T3', args: { actual: '$particles', theoretical: '$unitsIn', limit: '$particleLimit?' } },
  ],
};

// 20. AQL inspection after 100 % inspection (C7).
export const aqlSample: Block = {
  id: 'aql-sample', version: 1, name: 'AQL inspection after 100 % inspection', checker: true,
  instruction: 'Take the AQL sample from the inspected units and record the defects found per class.',
  fields: [num('lotSize', 'Lot size (good units)', 'units'), num('critical', 'Critical defects found', 'units'), num('major', 'Major defects found', 'units'), num('minor', 'Minor defects found', 'units')],
  settings: [
    { name: 'level', label: 'Inspection level', kind: 'text', options: ['I', 'II', 'III', 'S-1', 'S-2', 'S-3', 'S-4'] },
    { name: 'criticalAql', label: 'AQL critical', kind: 'number' }, { name: 'majorAql', label: 'AQL major', kind: 'number' }, { name: 'minorAql', label: 'AQL minor', kind: 'number' },
  ],
  calcs: [{ name: 'aql', label: 'AQL decision', template: 'C7', args: { lotSize: '$lotSize', level: '$level', classes: { critical: '$criticalAql', major: '$majorAql', minor: '$minorAql' }, found: { critical: '$critical', major: '$major', minor: '$minor' } } }],
};

// 21. Reconciliation of units (TI-18): theoretical, filled, rejects, samples, good; yield and accountability.
export const unitReconcile: Block = {
  id: 'unit-reconcile', version: 1, name: 'Reconciliation of units', checker: true, gmp: 'yield',
  instruction: 'Count the good units and add up every reject, sample and loss of the batch.',
  fields: [
    num('good', 'Good units', 'units'), num('fillRejects', 'Filling rejects', 'units'), num('inspectionRejects', 'Inspection and leak-test rejects', 'units'),
    num('samples', 'Samples', 'units'), num('removed', 'Units removed at interventions', 'units'), num('other', 'Other losses', 'units'),
  ],
  settings: [{ name: 'theoretical', label: 'Theoretical units', kind: 'quantity' }, limit('yieldLimit', 'Yield limits', false), limit('accountabilityLimit', 'Accountability limits', false)],
  calcs: [
    { name: 'yield', label: 'Unit yield', template: 'T3', args: { actual: '$good', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$theoretical', parts: [{ name: 'good', value: '$good' }, { name: 'filling rejects', value: '$fillRejects' }, { name: 'inspection rejects', value: '$inspectionRejects' }, { name: 'samples', value: '$samples' }, { name: 'removed', value: '$removed' }, { name: 'other', value: '$other' }], limit: '$accountabilityLimit' } },
  ],
};

// 22. Room and line conditions, periodically beside the stage.
export const roomStatus: Block = {
  id: 'room-status', version: 1, name: 'Room and line conditions', checker: false, periodic: { maxMinutes: 1440, alongside: true },
  instruction: 'At each round read the building management system: no alarm, differential pressures, temperature and humidity.',
  fields: [yes('noAlarm', 'No BMS alarm'), num('pressure', 'Differential pressure', 'Pa'), num('temperature', 'Temperature', '°C'), num('humidity', 'Relative humidity', '%RH', true)],
  settings: [limit('pressureLimit', 'Differential pressure limits', false), limit('temperatureLimit', 'Temperature limits'), limit('humidityLimit', 'Humidity limits')],
  calcs: [observe('alarmCheck', 'No BMS alarm', ['noAlarm']), within('pressureCheck', 'Differential pressure', 'pressure', 'pressureLimit'),
    within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), within('humidityCheck', 'Humidity', 'humidity?', 'humidityLimit?')],
};

// 23. Time out of refrigeration: an event log (engine change 2); a later step totals the entries.
export const torLog: Block = {
  id: 'tor-log', version: 1, name: 'Time out of refrigeration (log)', checker: false, log: true,
  instruction: 'Add an entry each time the product is out of the cold: where, from when to when.',
  fields: [text('where', 'Where'), time('start', 'Out of the cold at'), time('end', 'Back in the cold at')],
  settings: [limit('periodLimit', 'Longest single period out')],
  calcs: [duration('period', 'Time out', 'start', 'end', 'periodLimit?')],
};

// Reused block of Tablets with an injectables variant: dried to constant end point by a probe reading, then a minimum time.
export const dryProbe: Block = {
  id: 'dry-probe', version: 1, name: 'Dry to a probe end point', checker: false, stop: 'endPoint',
  instruction: 'Read the probe (e.g. absolute humidity in the vacuum line) at each round; once it is at the end point, dry for the minimum time.',
  fields: [num('reading', 'Probe reading', '$readingUnit'), num('temperature', 'Product temperature', '°C', true), time('reachedAt', 'End point reached at'), time('endAt', 'Drying ended at')],
  settings: [{ name: 'readingUnit', label: 'Probe unit', kind: 'text', options: ['g/m³', 'g/kg', '%RH', 'mbar'] }, limit('endPointLimit', 'End point', false), limit('afterLimit', 'Minimum time after the end point', false)],
  calcs: [within('endPoint', 'Probe at the end point', 'reading', 'endPointLimit'), duration('after', 'Time after the end point', 'reachedAt', 'endAt', 'afterLimit')],
};
