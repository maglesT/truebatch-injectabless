// The kind of a block's field, setting or calculation in a step (mass, volume, time, lethality …), worked out from
// the block's units and calculations: the designer offers only units of the right kind, and the master check refuses
// a limit of another kind (a master written through the API). Pure functions, shared by both.
import type { Block } from '../blocks/format.js';
import { refsIn } from '../blocks/format.js';
import { findUnit, type Kind } from '../templates/index.js';
import type { Step } from './schema.js';

export const kindOfUnit = (symbol: string | undefined): Kind | undefined => (symbol === undefined ? undefined : findUnit(symbol)?.kind);

const PERCENT_RESULT = ['T3', 'T4', 'T5'];
export const CHECKS = /^(C\d|F2)$/;

/** The kind of a field, setting or calculation of a block in a step (undefined when it cannot be told). */
export function kindOf(block: Block, name: string, settings: Step['settings'] = {}, seen = new Set<string>()): Kind | undefined {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const f = block.fields.find((x) => x.name === name);
  if (f) {
    if (f.kind !== 'number') return undefined;
    const u = f.unit?.startsWith('$') ? settings[f.unit.slice(1)] : f.unit;
    return typeof u === 'string' ? kindOfUnit(u) : undefined;
  }
  const c = block.calcs.find((x) => x.name === name);
  if (c) {
    if (CHECKS.test(c.template)) return undefined;
    if (PERCENT_RESULT.includes(c.template)) return 'fraction';
    for (const r of refsIn(c.args)) { const k = kindOf(block, r, settings, seen); if (k) return k; }
    return undefined;
  }
  const s = block.settings.find((x) => x.name === name);
  return s ? neededKind(block, name, settings, seen) : undefined;
}

/** The kind a setting must have: a quantity is of the kind of the values it is used with; a limit of what it limits. */
export function neededKind(block: Block, setting: string, settings: Step['settings'] = {}, seen = new Set<string>([setting])): Kind | undefined {
  const s = block.settings.find((x) => x.name === setting);
  for (const c of block.calcs) {
    const refs = refsIn(c.args);
    if (!refs.includes(setting)) continue;
    if (s?.kind === 'limit' && PERCENT_RESULT.includes(c.template)) return 'fraction';
    if (s?.kind === 'limit' && c.template === 'F2') return undefined;
    if (s?.kind === 'limit' && c.template === 'T13') return 'time';
    // I19's test temperature range limits the test temperature (°C), not the result (a pressure).
    if (s?.kind === 'limit' && c.template === 'I19' && refsIn(c.args.temperatureRange).includes(setting)) {
      const t = refsIn(c.args.temperature)[0];
      return t ? kindOf(block, t, settings, new Set(seen)) : undefined;
    }
    // T26's target and the donor's value are of the kind of the measured value (a concentration), not of the bulk's mass.
    const mixed = c.template === 'T26' ? refsIn([c.args.a, c.args.b, c.args.target]) : [];
    if (mixed.includes(setting)) {
      for (const r of mixed) { const k = r === setting ? undefined : kindOf(block, r, settings, new Set(seen)); if (k) return k; }
      continue;
    }
    // T6's result has a kind of its own, not its inputs' (a ratio of two volumes has no unit; Carr index is a %).
    if (s?.kind === 'limit' && c.template === 'T6') {
      const mode = (c.args as { mode?: string }).mode;
      return mode === 'carr' ? 'fraction' : mode === 'angle of repose' ? kindOfUnit('°') : kindOfUnit('');
    }
    for (const r of refs) {
      if (r === setting || block.settings.find((x) => x.name === r)?.kind === 'limit') continue;
      const k = kindOf(block, r, settings, new Set(seen));
      if (k) return k;
    }
  }
  return undefined;
}

