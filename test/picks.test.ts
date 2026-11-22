import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { balanceCapacity, dispensingRooms, emptyNote, machineRefusal, roomRefusal, untypedNote } from '../shared/engine/picks.js';
import { latestBlock } from '../shared/blocks/index.js';
import { skeletonList, skeletonStages } from '../web/src/designer/skeletons.js';

// The equipment and instrument types of the demo master data (owner's list, 15 Nov 2026) and of an injectables plant,
// with a few real types that share a word with them and must not be offered (filter press, air compressor, case packer,
// platform balance for a form-fill-seal machine, a container-closure leak tester for a filter test).
const TYPES = ['Balance', 'Analytical balance', 'Micro balance', 'IPC balance', 'Platform balance', 'Bin blender', 'Manufacturing vessel', 'Filter press',
  'Air compressor', 'Case packer', 'Compounding vessel', 'Mixing vessel', 'Homogeniser', 'Vial washer', 'Depyrogenation tunnel', 'Dry heat steriliser', 'Autoclave',
  'Vial filling machine', 'Syringe filling machine', 'Form-fill-seal machine', 'Freeze dryer', 'Filter integrity tester', 'Leak tester (HVLD)',
  'Container closure integrity tester', 'Visual inspection machine', 'Isolator', 'RABS', 'Capping machine', 'Vial crimper',
  // Blow-fill-seal and sterile powder (17 Nov 2026): the demo's BFS machines, LVP bag filler and powder filler.
  'Blow-fill-seal machine', 'LVP bag filling machine', 'Powder filling machine',
  // Run 3, H9: the demo's washers, and processors that are not washers (the stopper processor, a fluid bed processor).
  'Vial washing machine', 'Ultrasonic washer', 'Stopper processor', 'Fluid bed processor'];
const MACHINES = TYPES.map((type, i) => ({ code: `EQ-${i}`, type, room: null }));
const BALANCES = ['Balance', 'IPC balance', 'Platform balance'];
const VESSELS = ['Manufacturing vessel', 'Compounding vessel', 'Mixing vessel'];
const OFFERS: Record<string, string[]> = {
  'weigh.balance': BALANCES, 'charge.machine': ['Bin blender', ...VESSELS, 'Fluid bed processor'], 'dissolve.machine': VESSELS, 'mix.machine': ['Bin blender', ...VESSELS], 'make-up.machine': VESSELS, 'phase-prep.machine': VESSELS,
  'homogenise.machine': ['Homogeniser'], 'component-wash.washer': ['Vial washer', 'Vial washing machine', 'Ultrasonic washer'], 'depyrogenate.machine': ['Depyrogenation tunnel', 'Dry heat steriliser'],
  'sterilise.steriliser': ['Dry heat steriliser', 'Autoclave'], 'terminal-sterilise.steriliser': ['Dry heat steriliser', 'Autoclave'],
  // A liquid filler, not the powder filler, a blow-fill-seal or a bag machine (whole-suite run, S18).
  'fill.machine': ['Vial filling machine', 'Syringe filling machine', 'Form-fill-seal machine'],
  'ffs-run.machine': ['Form-fill-seal machine', 'Blow-fill-seal machine', 'LVP bag filling machine'], 'powder-fill.machine': ['Powder filling machine'],
  'lyo-load.dryer': ['Freeze dryer'], 'aseptic-ready.isolator': ['Isolator', 'RABS', 'Blow-fill-seal machine'], 'seal-check.capper': ['Capping machine', 'Vial crimper'], 'filter-test.tester': ['Filter integrity tester'], 'leak-test-100.machine': ['Leak tester (HVLD)', 'Container closure integrity tester'],
};

describe('machine pickers on the demo master-data types', () => {
  const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100', batchUnit: 'L' as const, fillVolumeMl: '10.0' };
  // The types alone: here every stage allows any room (the rooms are tested below).
  const stages = [...skeletonList().flatMap((s) => skeletonStages(s.id, header))].map((s) => ({ ...s, roomTypes: [] }));

  it('TI-11 every machine field of the skeletons offers the machines of its kind, never a QC lab balance', () => {
    const seen = new Set<string>();
    for (const stage of stages) for (const st of stage.steps) {
      for (const f of findBlock(st.block)!.fields.filter((x) => x.kind === 'machine')) {
        const key = `${st.block.id}.${f.name}`;
        seen.add(key);
        expect([key, MACHINES.filter((m) => !machineRefusal(stage, f, m, [])).map((m) => m.type)]).toEqual([key, OFFERS[key]]);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(OFFERS).sort());
  });

  it('TI-11 an analytical balance is refused on the floor with the reason', () => {
    const stage = stages[0]!;
    const balance = findBlock({ id: 'weigh', version: 1 })!.fields.find((f) => f.name === 'balance')!;
    expect(machineRefusal(stage, balance, { code: 'QC-BAL-1', type: 'Analytical balance', room: null }, [])).toBe('QC-BAL-1 is not a balance (master data: Analytical balance)');
  });

  // The demo's rooms and balances (master data, 15 Nov 2026): IN-BAL-03/04 stand in RM-101 (Dispensing), IN-BAL-05 in
  // RM-105 (Compression), IN-BAL-01/02/06 in RM-110 (QC), INQ-BAL-07 in RM-601 (Microbiology), and the liquids block's
  // INL-BAL-01 in RM-301 (Liquid dispensing).
  const ROOMS = [{ code: 'RM-101', area: 'Dispensing' }, { code: 'RM-103', area: 'Granulation' }, { code: 'RM-105', area: 'Compression' },
    { code: 'RM-107', area: 'Coating' }, { code: 'RM-108', area: 'Packing' }, { code: 'RM-110', area: 'QC' }, { code: 'RM-601', area: 'Microbiology' },
    { code: 'RM-301', area: 'Liquid dispensing' }];
  const BALS = [['IN-BAL-03', 'RM-101'], ['IN-BAL-04', 'RM-101'], ['IN-BAL-05', 'RM-105'], ['IN-BAL-01', 'RM-110'], ['INQ-BAL-07', 'RM-601'], ['INL-BAL-01', 'RM-301']]
    .map(([code, room]) => ({ code: code!, type: 'Balance', room }));
  const field = (block: string, name: string) => findBlock({ id: block, version: 1 })!.fields.find((f) => f.name === name)!;

  it('TI-11 a balance is offered in the master\'s dispensing rooms, with those of the stage\'s rooms; INL-BAL-01 of the liquids block is not; never a QC or laboratory balance', () => {
    const stage = { ...stages[0]!, roomTypes: ['Granulation', 'Coating'], machineTypes: ['Granulator', 'Coater'] };
    const offered = (block: string, s = stage, dispensing = ['RM-101']) => BALS.filter((b) => !machineRefusal(s, field(block, 'balance'), b, ROOMS, dispensing)).map((b) => b.code);
    expect(offered('weigh')).toEqual(['IN-BAL-03', 'IN-BAL-04']);
    expect(offered('weigh', { ...stage, roomTypes: ['Compression'] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05']);
    expect(offered('weigh', stage, ['RM-301'])).toEqual(['INL-BAL-01']);
    expect(offered('weigh', { ...stage, roomTypes: [] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05', 'INL-BAL-01']);
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[5]!, ROOMS, ['RM-101'])).toBe('INL-BAL-01 stands in RM-301 (Liquid dispensing), neither in a dispensing room of the master nor in a room this stage allows (Granulation, Coating): the master names the rooms each stage runs in');
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[3]!, ROOMS, ['RM-101'])).toBe('IN-BAL-01 stands in RM-110 (QC), a laboratory area: weigh with a balance of a dispensing room of the master or of a room this stage allows');
    // A version made before the setting: the rooms whose area is exactly "Dispensing".
    const old = { header: { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '1', batchUnit: 'L' as const } };
    expect(dispensingRooms(old, ROOMS)).toEqual(['RM-101']);
    expect(dispensingRooms({ header: { ...old.header, dispensingRooms: ['RM-102'] } }, ROOMS)).toEqual(['RM-102']);
  });

  it('TI-11 a machine is offered only standing in a room the stage allows; one with no type is named in the note', () => {
    const stage = { ...stages[0]!, roomTypes: ['Granulation'] };
    const sifter = field('dissolve', 'machine');
    const items = [{ code: 'EQ-S-01', type: 'Compounding vessel', room: 'RM-103' }, { code: 'EQ-X', type: 'Compounding vessel', room: 'RM-107' },
      { code: 'SF-01', type: 'Compounding vessel', room: null }, { code: 'SF-02', type: null, room: 'RM-103' }];
    expect(items.map((m) => machineRefusal(stage, sifter, m, ROOMS))).toEqual([null, 'EQ-X stands in RM-107 (Coating), not in a room this stage allows (Granulation): the master names the rooms each stage runs in',
      'SF-01 stands in no room in master data, so it is not in a room this stage allows (Granulation)', expect.stringContaining('SF-02 has no type in master data')]);
    expect(untypedNote(sifter, items)).toBe('1 machine has no type in master data, so it is not offered.');
  });

  it('TI-11 an empty machine picker says why: where the machines of its type stand, or that master data has none (17 Nov 2026 Tablets run, F17)', () => {
    const stage = { ...stages[0]!, roomTypes: ['RM-103'] };
    const vessel = field('dissolve', 'machine');
    const all = [{ code: 'EQ-V-01', type: 'Compounding vessel', room: 'RM-107' }, { code: 'EQ-N', type: null, room: null }, { code: 'EQ-AC-01', type: 'Autoclave', room: 'RM-103' }];
    expect(emptyNote(stage, vessel, all, ROOMS)).toBe('No vessel or mixer can be used here: EQ-V-01 stands in RM-107 (Coating), not in a room this stage allows (RM-103): the master names the rooms each stage runs in. '
      + '1 machine has no type in master data, so it is not offered. Engineering moves one into a room this stage allows, or adds one, in master data (the LEAD shows where each stands).');
    expect(emptyNote(stage, vessel, all.slice(1), ROOMS)).toBe('Master data has no active vessel or mixer. 1 machine has no type in master data, so it is not offered. Engineering adds it in master data.');
  });

  it('TI-11 run 3 H2, H10: a stage names its line\'s room; one rule for every machine: it stands in a room the stage names, and the refusal says why', () => {
    // The demo: RM-207 (vials) and RM-208 (prefilled syringes) are both "Aseptic filling"; RM-210 is "Capping".
    const rooms = [{ code: 'RM-207', area: 'Aseptic filling' }, { code: 'RM-208', area: 'Aseptic filling' }, { code: 'RM-210', area: 'Capping' }];
    const stage = { ...stages[0]!, roomTypes: ['RM-207', 'Capping'], machineTypes: [] };
    const iso = { code: 'EQS-ISO-01', type: 'Isolator', room: 'RM-207' }, rabs = { code: 'EQS-RAB-01', type: 'RABS', room: 'RM-208' };
    const vfm = { code: 'EQS-VFM-01', type: 'Vial filling machine', room: 'RM-207' }, sfm = { code: 'EQS-SFM-01', type: 'Syringe filling machine', room: 'RM-208' };
    const cap = { code: 'EQS-CAP-01', type: 'Capping machine', room: 'RM-210' };
    const isolator = latestBlock('aseptic-ready')!.fields.find((f) => f.name === 'isolator')!;
    const filler = field('fill', 'machine'), capper = latestBlock('seal-check')!.fields.find((f) => f.name === 'capper')!;
    // The line clearance offers only the line's own room (and the rooms of an area the stage names).
    expect(rooms.filter((r) => !roomRefusal(stage, r)).map((r) => r.code)).toEqual(['RM-207', 'RM-210']);
    expect([iso, rabs].filter((m) => !machineRefusal(stage, isolator, m, rooms)).map((m) => m.code)).toEqual(['EQS-ISO-01']);
    expect(machineRefusal(stage, isolator, rabs, rooms)).toBe('EQS-RAB-01 stands in RM-208 (Aseptic filling), not in a room this stage allows (RM-207, Capping): the master names the rooms each stage runs in');
    expect([vfm, sfm].filter((m) => !machineRefusal(stage, filler, m, rooms)).map((m) => m.code)).toEqual(['EQS-VFM-01']);
    expect(machineRefusal(stage, capper, cap, rooms)).toBeNull();
    expect(emptyNote(stage, isolator, [rabs], rooms)).toMatch(/^No isolator, rabs or blow-fill-seal machine can be used here: EQS-RAB-01 stands in RM-208 \(Aseptic filling\), not in a room this stage allows/);
  });
});

describe('A8 pickers: a machine with a capability and a balance for the quantity weighed (fix round 21 Nov 2026)', () => {
  const stage = { key: 's', name: 'S', kind: 'normal' as const, roomTypes: [], machineTypes: [], role: '', uses: [], steps: [] };
  it('a field that needs a capability takes only machines whose type or name names it', () => {
    const f = { name: 'machine', label: 'Isolator filler', kind: 'machine' as const, types: ['filling'], capability: ['isolator', 'rabs'] };
    const fillers = [{ code: 'EQS-FIL-01', type: 'Vial filling machine', name: 'Vial filling machine 120 vpm' }, { code: 'EQS-FIL-02', type: 'Vial filling machine', name: 'Vial filling machine (isolator)' },
      { code: 'EQS-FIL-03', type: 'Syringe filling machine', name: 'Syringe filler in RABS' }];
    expect(fillers.filter((m) => !machineRefusal(stage, f, m, [])).map((m) => m.code)).toEqual(['EQS-FIL-02', 'EQS-FIL-03']);
    expect(machineRefusal(stage, f, fillers[0]!, [])).toBe('EQS-FIL-01 is not a isolator machine (master data: Vial filling machine, Vial filling machine 120 vpm)');
  });
  it('a balance is offered when the quantity is within its capacity and at least 0.5 % of it; a name without a capacity is not checked', () => {
    const f = findBlock({ id: 'weigh', version: 1 })!.fields.find((x) => x.name === 'balance')!;
    const bal = [{ code: 'IN-BAL-03', type: 'Balance', name: 'Platform balance 300 kg' }, { code: 'IN-BAL-04', type: 'Balance', name: 'Precision balance 6 kg' },
      { code: 'IN-BAL-05', type: 'Balance', name: 'IPC balance (fill weight)' }];
    expect(balanceCapacity(bal[0]!)).toBe(300);
    expect(balanceCapacity({ code: 'x', name: 'Analytical balance 220 g' })).toBeCloseTo(0.22);
    const offered = (value: string, unit: string) => bal.filter((m) => !machineRefusal(stage, f, m, [], [], { value, unit })).map((m) => m.code);
    expect(offered('0.04', 'kg')).toEqual(['IN-BAL-04', 'IN-BAL-05']);
    expect(offered('12.000', 'kg')).toEqual(['IN-BAL-03', 'IN-BAL-05']);
    expect(offered('3.26', 'kg')).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05']);
    expect(machineRefusal(stage, f, bal[0]!, [], [], { value: '0.04', unit: 'kg' })).toBe('IN-BAL-03 (300 kg) is too large for 0.04 kg: a balance weighs at least 0.5 % of its capacity (1.5 kg); use a smaller balance');
    expect(machineRefusal(stage, f, bal[1]!, [], [], { value: '12', unit: 'kg' })).toBe('IN-BAL-04 weighs at most 6 kg: 12 kg is too much for it');
    expect(machineRefusal(stage, f, bal[0]!, [])).toBeNull();
  });
});
