// Process skeletons a new master may start from: the usual stages and steps of a process, as data. Settings that
// depend on the product (which material a step weighs, its limits) are left for the author; the master check lists
// them. Every stage is worked in a room, so each starts with line clearance (TI-10). A stage starts with the rooms it
// usually runs in, by the usual area names (TI-11). For now one skeleton from the blocks kept from TrueBatch Tablets:
// the skeletons by injectable type and route (phase F) come with the sterile blocks of the final library (phase E).
import { findBlock } from '../../../shared/blocks/index.js';
import type { MasterDoc, SettingValue, Stage, Step } from '../../../shared/master/schema.js';
import { stepFrom } from './model.js';

type Header = MasterDoc['header'];
interface StepPlan { block: string; key?: string; name?: string; checker?: boolean; settings?: (h: Header) => Record<string, SettingValue>; minMinutes?: number }
interface StagePlan { key: string; name: string; kind?: Stage['kind']; role: string; rooms?: string[]; produces?: [string, number]; uses?: string[]; steps: StepPlan[] }

const SKELETONS: { id: string; name: string; text: string; stages: StagePlan[] }[] = [
  {
    id: 'solution-compounding', name: 'Solution: compounding',
    text: 'Weighing, charging and mixing the bulk solution, a pH check and the bulk yield (filtration, filling and sterilisation come with the sterile blocks).',
    stages: [
      { key: 'compounding', name: 'Compounding', role: 'Compounding operator', rooms: ['Compounding'], produces: ['bulk solution', 24],
        steps: [{ block: 'weigh', key: 'weigh-api' }, { block: 'charge', key: 'charge-api' }, { block: 'mix', key: 'mix' },
          { block: 'check', key: 'ph', name: 'pH of the bulk solution' },
          { block: 'stage-yield', key: 'yield', settings: () => ({ theoretical: { header: 'batchMass' }, yieldLimit: { low: '97.0', high: '100.5', unit: '%' },
            accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } }) }] },
    ],
  },
];
export const SKELETON_LIST = SKELETONS.map(({ id, name, text }) => ({ id, name, text }));

/** The dispensing rooms a new master starts with (TI-11): the active rooms whose area is exactly "Dispensing". */
export const defaultDispensingRooms = (rooms: readonly { code: string; area: string | null; active: boolean }[]) =>
  rooms.filter((r) => r.active && r.area === 'Dispensing').map((r) => r.code);

/** The stages of a skeleton for this header. */
export function skeletonStages(id: string, h: Header): Stage[] {
  const sk = SKELETONS.find((s) => s.id === id);
  if (!sk) return [];
  return sk.stages.map((p) => ({
    key: p.key, name: p.name, kind: p.kind ?? 'normal', roomTypes: p.rooms ?? [], machineTypes: [], role: p.role, uses: p.uses ?? [],
    ...(p.produces ? { produces: { name: p.produces[0], holdHours: p.produces[1] } } : {}),
    steps: [{ block: 'line-clearance' }, ...p.steps].reduce<Step[]>((steps, sp) => {
      const block = findBlock({ id: sp.block, version: 1 })!;
      const base = stepFrom(block, steps.map((t) => t.key));
      const settings = Object.fromEntries(Object.entries({ ...base.settings, ...sp.settings?.(h) }).filter(([, v]) => v !== ''));
      return [...steps, { ...base, ...(sp.key ? { key: sp.key } : {}), ...(sp.name ? { name: sp.name } : {}), settings,
        ...(sp.checker ? { checker: true } : {}), ...(sp.minMinutes ? { minMinutes: sp.minMinutes } : {}) }];
    }, []),
  }));
}

