/**
 * The master calculation checks of the injectables library (v1 section 6, v1.1): error-proofing while a master is
 * built, as in Tablets (owner decision of 15 November 2026), not GMP rules. A refusal (⛔) is a clear maths or unit
 * error or the master's own numbers disagreeing; a warning (⚠️) is a question the author answers with a reason. The
 * checks that live inside a template (C5 in I9/I13, molar forms in I10, by-volume mixing in I17, a hold above the
 * validated maximum in I11, a product-wetted filter test without its factor in I19) refuse there, at the step. Checks
 * the master's data model makes impossible are met by design: the formula is in mg per mL (or per unit), never a %,
 * a dilution or a volume of liquid excipient (library checks 29, 30, 32, 33), and a bulk correction always starts
 * from the measured concentration (24).
 */
import { findBlock } from '../blocks/index.js';
import { Dec } from '../templates/index.js';
import { CLEAN_AIR, particleLimit } from './clean-air.js';
import type { Limit, MasterDoc, SettingValue, Step } from './schema.js';
import type { Answer } from './schema.js';

type Ask = (path: string, key: string, message: string, options: string[], needsReason?: boolean) => string | undefined;
type Refuse = (path: string, message: string, rule?: string) => void;

/** The steps of the master in order, with where they are. */
const stepsOf = (doc: MasterDoc) => doc.stages.flatMap((s, si) => s.steps.map((t, ti) => ({ s, si, t, ti, path: `stages[${si}].steps[${ti}]`, id: t.block.id })));
const limitOf = (v: SettingValue | undefined): Limit | undefined => (v && typeof v === 'object' && 'unit' in v ? v : undefined);
const lowOf = (v: SettingValue | undefined) => { const l = limitOf(v); return l?.low !== undefined ? new Dec(l.low) : undefined; };
const highOf = (v: SettingValue | undefined) => { const l = limitOf(v); return l?.high !== undefined ? new Dec(l.high) : undefined; };

// Words that name a substance that is usually dispensed as a solution, or that exists as several hydrates.
const SOLUTION = /\b(hydrochloric acid|phosphoric acid|sulfuric acid|sulphuric acid|acetic acid|lactic acid|sodium hydroxide|potassium hydroxide|sodium lactate|ethanol|albumin|glycerol|glycerin)\b/i;
const NAMED_SOLUTION = /\b(solution|\d+(\.\d+)?\s*%|concentrate)\b/i;
const HYDRATES = /\b(phosphate|dextrose|glucose|sodium acetate|magnesium sulfate|magnesium sulphate|calcium chloride|sodium citrate|citric acid|edetate|lactose|trehalose)\b/i;
const FORM_NAMED = /\b(anhydrous|monohydrate|dihydrate|trihydrate|heptahydrate|dodecahydrate|hemihydrate|hydrate)\b/i;
const ANTIOXIDANT = /\b(metabisulfite|metabisulphite|bisulfite|sulfite|ascorbic|ascorbate|cysteine|monothioglycerol|thioglycerol|tocopherol)\b/i;
const NON_AQUEOUS = /\b(oil|oleate|benzyl benzoate|polyethylene glycol|peg|propylene glycol|ethyl oleate)\b/i;
const SUSPENSION = /\b(suspension|emulsion|depot|microspheres?|liposom\w*)\b/i;

// The steps that fill product: a liquid (vials, ampoules, syringes; form-fill-seal or blow-fill-seal) or a sterile powder.
const LIQUID_FILLS = ['fill', 'fill-suspension', 'ffs-run'];
const FILLS = [...LIQUID_FILLS, 'powder-fill'];

export function sterileChecks(doc: MasterDoc, ask: Ask, refuse: Refuse): void {
  const h = doc.header;
  const steps = stepsOf(doc);
  const per = h.batchUnit === 'units' ? 'unit' : 'mL';
  const route = h.route;

  // TI-01: the route, and what the label claim is per (N1, library check 17).
  if (!route) refuse('header.route', 'Choose the route: terminal sterilisation, aseptic processing, or both', 'TI-01');
  const claims = doc.formula.filter((l) => l.role === 'api' && l.labelClaim);
  if (claims.length && !h.claimPer) refuse('header.claimPer', 'Say what the label claim is per (mL, the filled container, the delivered dose …)', 'TI-01');

  // 14 ⛔ the API per mL × the nominal fill gives the label claim per container (0.5 %).
  if (h.claimPer === 'container (filled content)' && h.fillVolumeMl) {
    doc.formula.forEach((l, i) => {
      if (l.role !== 'api' || !l.labelClaim || !l.mg) return;
      const m = /^(\d+(?:\.\d+)?)\s*(mg|g|µg|mcg)$/.exec(l.labelClaim.trim());
      if (!m) return;
      const got = new Dec(l.mg).times(h.fillVolumeMl!);
      const want = new Dec(m[1]!).times(({ mg: '1', g: '1000', 'µg': '0.001', mcg: '0.001' } as Record<string, string>)[m[2]!]!);
      if (got.minus(want).abs().div(want).times(100).gt('0.5')) {
        refuse(`formula[${i}].labelClaim`, `${l.name}: ${l.mg} mg/mL × ${h.fillVolumeMl} mL nominal fill = ${got.toString()} mg, not the label claim ${l.labelClaim} per container (the fill volume is the claim ÷ the concentration). Write the label quantity per mL; a surplus is an overage with its reason (library check 14)`);
      }
    });
  }
  // 15 ⛔ the fill excess counted as an API overage.
  if (h.fillVolumeMl && h.fillExcessMl && new Dec(h.fillExcessMl).gt(0)) {
    const excessPct = new Dec(h.fillExcessMl).div(h.fillVolumeMl).times(100);
    doc.formula.forEach((l, i) => {
      const o = l.adjust?.overage?.percent;
      if (l.role === 'api' && o && new Dec(o).minus(excessPct).abs().lte('0.5')) {
        refuse(`formula[${i}].adjust.overage`, `${l.name}: the overage ${o} % is the fill excess (${h.fillExcessMl} mL of ${h.fillVolumeMl} mL). The bulk is made at the nominal concentration; the fill excess is the header's, never an overage (library check 15)`);
      }
    });
  }
  // 16 ⚠️ a liquid filled with no excess.
  if (h.batchUnit !== 'units' && h.fillVolumeMl && (!h.fillExcessMl || new Dec(h.fillExcessMl).isZero())) {
    ask('header.fillExcessMl', 'fill-excess', 'The fill has no excess: units may hold less than the label volume (the pharmacopoeia excess table is the usual default). Confirm with a reason, or add the excess.', ['no excess, confirmed'], true);
  }
  // 22 ⚠️ a fixed nominal content where the lot has a measured one.
  doc.formula.forEach((l, i) => {
    const c = l.adjust?.content;
    if (c?.nominalContent && c.contentSource !== 'in-process result') {
      ask(`formula[${i}].adjust`, `nominal-content/${l.key}`, `${l.name} uses the nominal content ${c.nominalContent} %. Where the lot's certificate gives a measured content, use it (up to 23 % in the formulation test). Confirm the nominal content with a reason, or adjust by the lot.`, ['nominal confirmed'], true);
    }
  });
  // 25 ⚠️ a multivalent product whose antigen lines all carry the same target.
  const apis = doc.formula.filter((l) => l.role === 'api' && l.mg);
  if (apis.length >= 3 && apis.every((l) => l.mg === apis[0]!.mg)) {
    ask('formula', 'same-target', `All ${apis.length} active lines carry the same quantity (${apis[0]!.mg} mg per ${per}). In a multivalent product each antigen or serotype has its own target (50 % under-dose in the formulation test). Confirm each line's own target.`, ['each line confirmed'], true);
  }
  // 31 ⚠️ a substance named pure but dispensed as a solution; 34 ⚠️ an excipient with several hydrates named without its form.
  doc.formula.forEach((l, i) => {
    if (SOLUTION.test(l.name) && !NAMED_SOLUTION.test(l.name) && !l.adjust?.content) {
      ask(`formula[${i}]`, `solution/${l.key}`, `${l.name} is usually dispensed as a solution: give the solution's content (content adjustment) so the pure quantity is weighed, or confirm it is the pure substance.`, ['the pure substance'], true);
    }
    if (l.role !== 'api' && HYDRATES.test(l.name) && !FORM_NAMED.test(l.name)) {
      ask(`formula[${i}]`, `hydrate/${l.key}`, `${l.name} exists as several hydrates: name the form weighed (anhydrous or the hydrate) as on the label and the material record (9 % to 2 × in the formulation test).`, ['form as in the material record'], true);
    }
  });
  // 26 ⛔ a q.s. or fill target at water's density when the solutes are more than 2 % w/v.
  const solutes = doc.formula.filter((l) => l.role !== 'solvent' && l.mg).reduce((t, l) => t.plus(l.mg!), new Dec(0));
  const nonAqueous = doc.formula.some((l) => l.role === 'solvent' && NON_AQUEOUS.test(l.name));
  if (h.batchUnit !== 'units' && h.densityGPerMl && new Dec(h.densityGPerMl).eq(1) && (solutes.gt(20) || nonAqueous)) {
    refuse('header.densityGPerMl', `The density is water's (1.000 g/mL) but the solutes are ${solutes.toString()} mg/mL${nonAqueous ? ' in a non-aqueous vehicle' : ''}: give the measured or stated density of the bulk (1-40 % in the formulation test; library check 26)`);
  }

  // Step order: 36 ⛔ API charged before a carbon treatment; 37/38 additions between the sterile filtration and filling.
  const isApiStep = (t: Step) => Object.values(t.settings).some((v) => typeof v === 'object' && 'formula' in v && doc.formula.find((l) => l.key === v.formula)?.role === 'api');
  const carbon = steps.findIndex((x) => x.id === 'treat-until-clear');
  if (carbon >= 0 && steps.slice(0, carbon).some((x) => x.si === steps[carbon]!.si && (x.id === 'charge' || x.id === 'weigh') && isApiStep(x.t))) {
    refuse(steps[carbon]!.path, 'The API is charged before the carbon treatment of the same vessel: carbon adsorbs the API (library check 36)');
  }
  const filter = steps.findIndex((x) => x.id === 'filtration');
  const filling = steps.findIndex((x, n) => n > filter && LIQUID_FILLS.includes(x.id));
  if (filter >= 0 && filling > filter) {
    const between = steps.slice(filter + 1, filling).filter((x) => ['charge', 'ph-adjust', 'make-up', 'bulk-adjust', 'dissolve'].includes(x.id));
    for (const x of between) {
      if (route === 'aseptic' || route === 'both') refuse(x.path, `${findBlock(x.t.block)?.name ?? x.id} comes between the sterile filtration and filling: in an aseptic master anything added after the filter must itself be sterile-filtered (library check 37)`, 'TI-25');
      else ask(x.path, `after-filter/${x.s.key}/${x.t.key}`, 'Something is added after the filtration: confirm the bioburden sample is taken after the last addition (library check 38).', ['bioburden after the last addition'], true);
    }
  }

  // Sterility: 39 ⛔ product-wetted filter test without its factor; 40 ⛔ gauge and absolute mixed.
  for (const x of steps.filter((y) => y.id === 'filter-test')) {
    const w = x.t.settings.wettedWith;
    if ((w === 'product' || w === 'solvent') && x.t.settings.productFactor === undefined) refuse(`${x.path}.settings.productFactor`, `A ${w}-wetted integrity test needs the validated product factor (library check 39)`, 'TI-25');
    const unit = String(x.t.settings.resultUnit ?? '');
    const lim = String(x.t.settings.makerLimit ?? '');
    if (unit && lim && / g$/.test(unit) !== / g$/.test(lim.trim()) && !/mL\/min/.test(unit + lim)) refuse(`${x.path}.settings.makerLimit`, `The result is in ${unit} and the maker's limit is "${lim}": gauge and absolute pressure are never mixed (library check 40)`, 'TI-25');
  }
  // 41/42 ⛔ the route and its heat steps; 43 ⚠️ a minimum F0 below the 15 min reference.
  const terminal = steps.filter((x) => x.id === 'terminal-sterilise');
  const heat = steps.filter((x) => x.id === 'heat-treatment');
  // A bulk only (no fill step) is sterilised where it is filled, under that master.
  const filled = steps.some((x) => FILLS.includes(x.id));
  if (filled && (route === 'terminal' || route === 'both') && !terminal.length) refuse('header.route', 'The route is terminal but no terminal sterilisation step has a minimum F0: a heat treatment or pasteurisation is not sterilisation (library check 41)', 'TI-24');
  if (route === 'terminal' && heat.length) refuse(heat[0]!.path, 'A heat step below sterilising lethality in a master whose route is terminal: the route must be "both" (or aseptic), with the full aseptic record (library check 42)', 'TI-24');
  for (const x of terminal) {
    const low = lowOf(x.t.settings.lethalityLimit);
    if (low && low.lt(15)) ask(`${x.path}.settings.lethalityLimit`, `low-f0/${x.s.key}/${x.t.key}`, `The minimum lethality ${low.toString()} F-min is below the 15 min reference: name the validation and the bioburden limit before sterilisation (library check 43).`, ['validated, named in the instruction'], true);
    // v1.1 ⛔ moist heat on a sealed non-aqueous fill: dry heat (FH).
    if (x.t.settings.medium === 'moist heat' && nonAqueous) refuse(`${x.path}.settings.medium`, 'Moist heat cannot reach a sealed non-aqueous fill: choose dry heat with its FH (library v1.1)', 'TI-24');
  }
  // 44 ⛔ an irradiation minimum dose written as a range.
  for (const x of steps.filter((y) => y.id === 'irradiation')) {
    const l = limitOf(x.t.settings.minDoseLimit);
    if (l && l.high !== undefined) refuse(`${x.path}.settings.minDoseLimit`, 'The validated sterilising dose is a minimum, not a range (library check 44)', 'TI-24');
  }
  // 47 ⛔ a dissolved-oxygen limit above saturation (about 9 mg/L at 20 °C); 48 ⛔ nitrogen optional with an oxygen limit or an antioxidant.
  for (const x of steps.filter((y) => y.id === 'nitrogen')) {
    const hi = highOf(x.t.settings.oxygenLimit);
    if (x.t.settings.oxygenUnit === 'mg/L' && hi && hi.gt(9)) refuse(`${x.path}.settings.oxygenLimit`, `A dissolved-oxygen limit of ${hi.toString()} mg/L is above saturation (about 9 mg/L at 20 °C): it can never fail (library check 47)`);
    if (x.t.flow.kind === 'optional-with-reason' && doc.formula.some((l) => ANTIOXIDANT.test(l.name))) refuse(`${x.path}.flow`, 'The nitrogen step cannot be optional in a product with an antioxidant or an oxygen limit (library check 48)');
  }
  // Template round part 1. 20 ⛔ a blend filled by the active's potency; 21 ⛔ one active of a blend sets the fill weight with no
  // check of each other active; the label claim of the fill is the formula's.
  for (const x of steps.filter((y) => y.id === 'powder-fill' && y.t.block.version >= 2)) {
    const actives = doc.formula.filter((l) => l.role === 'api');
    if (x.t.settings.powderIs === 'a blend or co-processed powder' && x.t.settings.basis !== undefined && x.t.settings.basis !== 'as is') {
      refuse(`${x.path}.settings.basis`, `A blend or co-processed powder is filled by its own content as it is, not by the potency of the active on the ${String(x.t.settings.basis)} basis: the fill weight would be wrong by the blend's ratio (library check 20)`);
    }
    if (actives.length > 1 && !limitOf(x.t.settings.otherLimit)) {
      refuse(`${x.path}.settings.otherLimit`, `The fill weight is set from one of ${actives.length} actives: set the limits of the other active's amount per unit, so a wrong ratio in the blend is seen (library check 21)`);
    }
    const claim = typeof x.t.settings.labelClaim === 'string' ? /^(\d+(?:\.\d+)?)\s*mg$/.exec(x.t.settings.labelClaim.trim()) : null;
    const api = actives[0];
    if (claim && api?.mg && h.batchUnit === 'units' && !new Dec(claim[1]!).eq(api.mg)) {
      refuse(`${x.path}.settings.labelClaim`, `The label claim of the fill (${claim[1]} mg per unit) is not the formula's ${api.name} (${api.mg} mg per unit): take the formula's quantity`);
    }
  }
  // v1.1 check 7 ⛔ whole-container dose: no fill excess unless the claim is the filled content; the fill limits are two-sided.
  if (h.claimPer === 'delivered dose' && h.fillExcessMl && new Dec(h.fillExcessMl).gt(0)) {
    refuse('header.fillExcessMl', 'The label claim is the delivered dose of the whole container: a fill excess would change the dose. Use no excess unless the claim is the filled content (library v1.1)');
  }
  for (const x of steps.filter((y) => FILLS.includes(y.id))) {
    for (const name of ['meanLimit', 'eachLimit']) {
      const l = limitOf(x.t.settings[name]);
      if (l && (l.low === undefined || l.high === undefined)) refuse(`${x.path}.settings.${name}`, 'The fill weight limits are set on both sides (a low and a high limit): a limit on one side lets an over-filled container pass (library v1.1)');
    }
  }
  // The sterile rules: the steps a master of this route must have (TI-01 lists them; each rule names its own).
  const ids = new Set(steps.map((x) => x.id));
  // They apply to a master that fills product (a fill, form-fill-seal or blow-fill-seal, or powder fill step).
  const fills = FILLS.some((id) => ids.has(id));
  const aseptic = fills && (route === 'aseptic' || route === 'both');
  const need = (id: string, why: string, rule: string) => { if (!ids.has(id)) refuse('stages', why, rule); };
  if (aseptic) {
    if (!doc.stages.some((s) => s.aseptic)) refuse('stages', 'An aseptic master marks its aseptic stages (set-up, filling, closing): only aseptic operators work in them', 'TI-23');
    for (const [si, s] of doc.stages.entries()) {
      if (!s.aseptic) continue;
      const first = s.steps.findIndex((t) => t.block.id !== 'line-clearance');
      if (s.steps[first]?.block.id !== 'aseptic-ready') refuse(`stages[${si}]`, `The aseptic stage ${s.name} starts with the aseptic set-up (people, the line's media fill, sterilised items, gloves, grade A air)`, 'TI-23');
      if (s.steps.some((t) => FILLS.includes(t.block.id)) && !s.steps.some((t) => t.block.id === 'interventions')) refuse(`stages[${si}]`, `The aseptic filling stage ${s.name} has an interventions and stoppages log`, 'TI-28');
    }
    // A liquid is sterile filtered; a sterile powder filled as it is has no filtration (owner, 17 Nov 2026), and its filter
    // tests apply only when it has one.
    const liquid = LIQUID_FILLS.some((id) => ids.has(id));
    if (liquid && !ids.has('filtration-inline')) need('filtration', 'An aseptic master has its sterile filtration (with the bioburden sample just before the filter)', 'TI-25');
    if ((liquid || ids.has('filtration') || ids.has('filtration-inline')) && steps.filter((x) => x.id === 'filter-test').length < 2) {
      ask('stages', 'pupsit', 'An aseptic master tests the sterilising filter before use (after sterilisation) and after use. A pre-use test is left out only under the plant\'s risk assessment (Annex 1 8.87): confirm with its reference, or add the pre-use test.', ['pre-use test left out by the risk assessment'], true);
      need('filter-test', 'The sterilising filter is integrity tested after use', 'TI-25');
    }
  }
  if (fills) need('qa-sample', 'The master takes the sterility and endotoxin samples where the release needs them (each sub-batch or load)', 'TI-26');
  if (fills && !ids.has('leak-test-100') && !ids.has('seal-check') && !ids.has('headspace-gas')) refuse('stages', 'The master closes and checks the containers (seal check or 100 % container-closure test)', 'TI-29');
  if (fills) need('visual-inspect', 'Every filled unit is inspected (100 % visual inspection)', 'TI-30');
  if (ids.has('lyo-cycle') && (!ids.has('lyo-load') || !ids.has('lyo-unload'))) refuse('stages', 'Freeze-drying has its loading and its stoppering and unloading with the cycle', 'TI-31');
  const LATER = ['incubated-results', 'incubated-em', 'incubated-lab', 'incubated-bioburden'];
  if (LATER.some((id) => ids.has(id)) && !doc.stages.some((s) => s.startsAfter && s.steps.some((t) => LATER.includes(t.block.id)))) {
    refuse('stages', 'Incubated results (EM, BIs, bioburden) are read in a stage that starts after the step that took the samples', 'TI-26');
  }

  // 50 ⛔ a suspension or emulsion filled without content at start, middle and end.
  if (SUSPENSION.test(h.productName) && steps.some((x) => x.id === 'fill' || x.id === 'fill-suspension') && steps.filter((x) => x.id === 'qa-sample').length < 3) {
    refuse('stages', 'A suspension or emulsion is sampled for content at the start, middle and end of filling (three samples), with stirring on in every fill round (library check 50)');
  }
  // 50 / 21 ⛔ a suspension filled by the plain fill block: stirring is optional there, so it could never be recorded.
  if (SUSPENSION.test(h.productName)) {
    for (const x of steps.filter((y) => y.id === 'fill')) refuse(x.path, 'A suspension or emulsion is filled with the block that checks the stirring every round ("Fill a suspension or emulsion"), not the plain fill (library check 50)');
  }

  // Template round part 5. The recipe has as many phases as the step says; dry heat has its own reference temperature and z-value (FH).
  for (const x of steps) {
    const recipe = x.t.settings.phaseRecipe, n = x.t.settings.phases;
    if (typeof recipe === 'string' && typeof n === 'string' && /^\d+$/.test(n) && recipe.split('|').filter((r) => r.trim()).length !== Number(n)) {
      refuse(`${x.path}.settings.phases`, `The recipe lists ${recipe.split('|').filter((r) => r.trim()).length} phases but the step records ${n}: they must be the same`);
    }
    if (x.id === 'terminal-sterilise' && x.t.block.version >= 2 && x.t.settings.medium === 'dry heat (sealed ampoules)' && (!x.t.settings.tref || !x.t.settings.zvalue)) {
      refuse(`${x.path}.settings.tref`, 'Dry heat is not worked out at 121.1 °C and z 10 °C: give its own reference temperature and z-value from the validation (FH)', 'TI-24');
    }
  }

  // Template round part 4 (I22). The clean-air table is the limit: a tighter action limit may be set, never a looser one (also
  // refused at the step by I22). 45 ⚠️ a bioburden limit written per mL instead of per 100 mL.
  for (const x of steps.filter((y) => y.id === 'em-filling' && y.t.block.version >= 2)) {
    const grade = x.t.settings.grade as keyof typeof CLEAN_AIR.particles | undefined, state = x.t.settings.state === 'at rest' ? 'atRest' : x.t.settings.state === 'in operation' ? 'inOperation' : undefined;
    if (!grade || !state) continue;
    for (const [name, size] of [['limit05', '0.5'], ['limit5', '5']] as const) {
      const v = x.t.settings[name];
      if (typeof v !== 'string') continue;
      const m = /^(\d+(?:\.\d+)?)\s*particles\/m³$/.exec(v.trim());
      const table = particleLimit(grade, state, size);
      if (!m) refuse(`${x.path}.settings.${name}`, `Write the action limit in particles/m³, like the clean-air table ("${v}" is not)`);
      else if (table !== null && new Dec(m[1]!).gt(table)) refuse(`${x.path}.settings.${name}`, `The action limit ${v} is looser than the clean-air table for grade ${grade} ${String(x.t.settings.state)} (${table} particles/m³): a master may only set a tighter limit`);
    }
  }
  for (const x of steps.filter((y) => y.id === 'incubated-bioburden')) {
    const v = x.t.settings.bioburdenLimit;
    if (typeof v === 'string' && /\/\s*mL\b/i.test(v)) ask(`${x.path}.settings.bioburdenLimit`, `bioburden-basis/${x.s.key}/${x.t.key}`, `The bioburden limit "${v}" is per mL: a bioburden limit is written per 100 mL (a limit per mL is 100 times weaker). Rewrite it per 100 mL, or confirm with a reason.`, ['per mL confirmed'], true);
  }

  // Template round part 3: the cheap master checks.
  // 46 ⛔ an inert-gas headspace limit written as a maximum (it must be a minimum).
  for (const x of steps.filter((y) => y.id === 'headspace-gas')) {
    const l = limitOf(x.t.settings.gasLimit);
    if (l && l.high !== undefined && l.low === undefined) refuse(`${x.path}.settings.gasLimit`, 'An inert-gas headspace limit is a minimum (the gas fraction at least this): written as a maximum, a container of air would pass (library check 46)');
  }
  // 18 ⚠️ two label bases on one line (mg and IU); 19 ⛔ two forms of one active each name their basis.
  doc.formula.forEach((l, i) => {
    if (l.role === 'api' && l.labelClaim && /\bmg\b/i.test(l.labelClaim) && /\b(IU|units?)\b/i.test(l.labelClaim)) {
      ask(`formula[${i}].labelClaim`, `two-bases/${l.key}`, `${l.name} has a label claim in mg and in IU: one of them drives the lot adjustment, the other is only checked. Say which, with a reason.`, ['the mg claim drives it', 'the IU claim drives it'], true);
    }
  });
  const forms = new Map<string, number[]>();
  doc.formula.forEach((l, i) => { if (l.role === 'api') { const k = l.name.trim().split(/\s+/)[0]!.toLowerCase(); forms.set(k, [...(forms.get(k) ?? []), i]); } });
  for (const idx of forms.values()) {
    const bad = idx.filter((i) => !/\b(as|base|salt|parent|equivalent)\b/i.test(doc.formula[i]!.labelClaim ?? ''));
    if (idx.length > 1 && bad.length) refuse(`formula[${bad[0]}].labelClaim`, `${doc.formula[bad[0]!]!.name} is one of ${idx.length} forms of one active: each line's label claim names its basis ("as base", "as salt" ...), so the forms are never added on different bases (library check 19)`);
  }
  // 27 ⚠️ the density stated at another temperature than the bulk is made up or filled at.
  if (h.densityAtC && h.fillAtC && new Dec(h.densityAtC).minus(h.fillAtC).abs().gt(2)) {
    ask('header.fillAtC', 'density-temperature', `The density is stated at ${h.densityAtC} °C but the bulk is made up or filled at ${h.fillAtC} °C: the fill weight is off by about 0.02 % per °C for water (more for oils). Give the density at the fill temperature, or confirm with a reason.`, ['density difference accepted'], true);
  }
  // v1.1 1 ⚠️ a dilution of a drug substance that is itself a solution: the excipients' final concentrations equal the formula.
  const solutionDs = doc.formula.some((l) => l.role === 'api' && l.adjust?.content);
  const diluting = steps.find((x) => x.id === 'bulk-adjust' && x.t.settings.direction === 'dilute with the vehicle');
  if (solutionDs && diluting && doc.formula.some((l) => l.role === 'excipient')) {
    ask(diluting.path, 'ds-dilution', 'The drug substance solution is diluted with the vehicle: its own excipients are diluted too. Confirm that each excipient\'s final concentration still equals the formula (library v1.1 check 1).', ['final concentrations checked'], true);
  }
  // v1.1 2 ⚠️ an electrolyte figure per gram names its basis.
  doc.formula.forEach((l, i) => {
    if (l.labelClaim && /\b(mEq|mmol)\s*(\/|per)\s*g\b/i.test(l.labelClaim) && !/\b(salt|parent|base|anhydrous|hydrate|as)\b/i.test(l.labelClaim)) {
      ask(`formula[${i}].labelClaim`, `per-gram/${l.key}`, `${l.name}: an electrolyte figure per gram says whether it is per gram of the salt or of the parent (the ion).`, ['per gram of the salt', 'per gram of the parent'], true);
    }
  });
  // v1.1 3 ⚠️ two irradiation steps: each its own validated minimum dose (not the same figure copied).
  const irr = steps.filter((x) => x.id === 'irradiation');
  if (irr.length > 1) {
    const dose = (x: (typeof irr)[number]) => limitOf(x.t.settings.minDoseLimit)?.low;
    irr.slice(1).forEach((x) => {
      if (dose(x) !== undefined && irr.some((y) => y !== x && dose(y) === dose(x))) {
        ask(`${x.path}.settings.minDoseLimit`, `irradiation-dose/${x.s.key}/${x.t.key}`, 'Two irradiation steps have the same minimum dose: each has its own validated minimum. Confirm the reference of each validation.', ['each validated, named in the instruction'], true);
      }
    });
  }
  // v1.1 5 ⚠️ no q.s. component: the lines must add up to the density, or the batch is fixed by masses.
  if (h.batchUnit !== 'units' && h.densityGPerMl && doc.formula.length > 1 && !doc.formula.some((l) => l.role === 'solvent')) {
    const total = doc.formula.filter((l) => l.mg).reduce((t, l) => t.plus(l.mg!), new Dec(0));
    const want = new Dec(h.densityGPerMl).times(1000);
    if (total.minus(want).abs().div(want).gt('0.01')) ask('formula', 'no-qs', `No line is made up to volume (q.s.), and the lines add up to ${total.toString()} mg/mL while the density says ${want.toString()} mg/mL: the batch is fixed by masses with the densities of the lots. Confirm, or add the vehicle.`, ['fixed by masses, confirmed'], true);
  }
}

export type { Answer };
