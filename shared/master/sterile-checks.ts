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
      const m = /^(\d+(?:\.\d+)?)\s*mg$/.exec(l.labelClaim.trim());
      if (!m) return;
      const got = new Dec(l.mg).times(h.fillVolumeMl!);
      const want = new Dec(m[1]!);
      if (got.minus(want).abs().div(want).times(100).gt('0.5')) {
        refuse(`formula[${i}].labelClaim`, `${l.name}: ${l.mg} mg/mL × ${h.fillVolumeMl} mL nominal fill = ${got.toString()} mg, not the label claim ${l.labelClaim} per container. Write the label quantity per mL; a surplus is an overage with its reason (library check 14)`);
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
  const filling = steps.findIndex((x, n) => n > filter && x.id === 'fill');
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
  if ((route === 'terminal' || route === 'both') && !terminal.length) refuse('header.route', 'The route is terminal but no terminal sterilisation step has a minimum F0: a heat treatment or pasteurisation is not sterilisation (library check 41)', 'TI-24');
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
  // 50 ⛔ a suspension or emulsion filled without content at start, middle and end.
  if (SUSPENSION.test(h.productName) && steps.some((x) => x.id === 'fill') && steps.filter((x) => x.id === 'qa-sample').length < 3) {
    refuse('stages', 'A suspension or emulsion is sampled for content at the start, middle and end of filling (three samples), with stirring on in every fill round (library check 50)');
  }
}

export type { Answer };
