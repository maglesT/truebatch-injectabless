// Template round (22 Nov 2026): the calculation layer of the injectables library wired into the blocks and the master checks.
import { describe, expect, it } from 'vitest';
import { latestBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { evaluate, parseKey } from '../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { masterChecks } from '../shared/master/checks.js';
import { stepFrom } from '../web/src/designer/model.js';
import { timers } from '../shared/engine/index.js';
import { at, ev, small } from './engine-fixture.js';

const header = { productItemId: 'p', productCode: 'P', productName: 'Examplol for injection', batchSize: '20000', batchUnit: 'units', route: 'aseptic', claimPer: 'container (filled content)', dispensingRooms: ['D'] };
const one = (id: string, settings: object, h: object = {}, formula: object[] = []): MasterDoc => {
  const b = latestBlock(id)!;
  return masterSchema.parse({ header: { ...header, ...h }, formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'Examplol', mg: '500.0', role: 'api' }, ...formula],
    stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [{ ...stepFrom(b, []), key: 't', settings: { ...stepFrom(b, []).settings, ...settings } }] }] });
};
const run = (doc: MasterDoc, values: object) => evaluate(doc, [], parseKey('0.1.0.1')!, values as never);
const g = (value: string) => ({ value, unit: 'g' });
const pct = (value: string) => ({ value, unit: '%' });
const msgs = (d: MasterDoc) => masterChecks(d).map((p) => p.message);

describe('part 1: powder fill target per lot, with the excess', () => {
  const settings = { units: '4', labelClaim: '500 mg', excess: '25 mg', basis: 'as is', standardIs: 'anhydrous', powderIs: 'the active itself', meanBand: '2.0', eachBand: '5.0', humidityLimit: { high: '35', unit: '%RH' } };
  const values = (assay: string, weights: string[]) => ({ assay: pct(assay), weights: weights.map(g), humidity: { value: '28', unit: '%RH' }, stoppers: 'yes', counter: { value: '10', unit: 'units' }, filling: 'going on' });
  it('the block is valid and the fill weight comes from the lot: (500 mg + 25 mg excess) / 98 % = 0.5357 g, the excess shown', () => {
    const b = latestBlock('powder-fill')!;
    expect([b.version, blockProblems(b)]).toEqual([2, []]);
    const d = one('powder-fill', settings);
    const r = run(d, values('98.0', ['0.5360', '0.5350', '0.5370', '0.5340']));
    expect((r.target as { message?: string }).message).toBeUndefined();
    expect(r.target).toMatchObject({ ok: true, value: expect.stringMatching(/^0\.53571/), unit: 'g' });
    expect((r.target as { shown: string }).shown).toMatch(/excess/i);
    expect(r.meanCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(r.each).toMatchObject({ ok: true, check: { pass: true } });
    // The same weights are 5 % under for a lot of 93 % content: refused, the target moved with the lot.
    const low = run(d, values('93.0', ['0.5360', '0.5350', '0.5370', '0.5340']));
    expect(low.target).toMatchObject({ ok: true, value: expect.stringMatching(/^0\.56451/) });
    expect(low.each).toMatchObject({ ok: true, check: { pass: false } });
  });
  it('check 21: a blend of several actives needs the limits of the other active per unit, and a value outside them fails', () => {
    const second = [{ key: 'y', materialItemId: 'm2', code: 'M2', name: 'Examplox', mg: '250.0', role: 'api' }];
    expect(msgs(one('powder-fill', settings, {}, second)).join('|')).toMatch(/other active/);
    const d = one('powder-fill', { ...settings, otherLimit: { low: '240', high: '260', unit: 'mg' } }, {}, second);
    expect(msgs(d).join('|')).not.toMatch(/other active/);
    expect(run(d, { ...values('98.0', ['0.5360']), otherPerUnit: { value: '270', unit: 'mg' } }).otherCheck).toMatchObject({ check: { pass: false } });
  });
  it('check 20: a blend is on its own content as it is, not the active\'s anhydrous potency; check v1.1-7: fill limits on both sides, no excess for a delivered dose', () => {
    expect(msgs(one('powder-fill', { ...settings, powderIs: 'a blend or co-processed powder', basis: 'anhydrous' })).join('|')).toMatch(/blend/);
    expect(msgs(one('powder-fill', { ...settings, powderIs: 'a blend or co-processed powder' })).join('|')).not.toMatch(/blend's content/);
    const liquid = one('fill', { needles: '4', meanLimit: { low: '10.5', unit: 'g' }, band: '2' }, { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' });
    expect(msgs(liquid).join('|')).toMatch(/both sides/);
    expect(msgs(one('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' }, { batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' })).join('|')).not.toMatch(/both sides/);
    expect(msgs(one('fill', { needles: '4', meanLimit: { low: '10.5', high: '10.7', unit: 'g' }, band: '2' }, { claimPer: 'delivered dose', batchUnit: 'L', batchSize: '100', densityGPerMl: '1.0', fillVolumeMl: '10.0', fillExcessMl: '0.5' })).join('|')).toMatch(/delivered/);
  });
});

describe('part 2: a hold above the validated maximum (check 49)', () => {
  const done = [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 10 })];
  it('the master refuses a hold longer than its validated maximum, for an intermediate and for a time limit', () => {
    const doc = small([{ produces: { name: 'bulk', holdHours: 120, validatedMaxHours: 24 } }, { uses: ['s0'] }]);
    expect(masterChecks(doc).map((p) => p.message)).toContain('The hold time of bulk (120 h) is longer than its validated maximum (24 h): use the validated maximum, or the shorter where two are given');
    expect(masterChecks(small([{ produces: { name: 'bulk', holdHours: 24, validatedMaxHours: 24 } }, { uses: ['s0'] }])).map((p) => p.message).join('|')).not.toMatch(/validated maximum/);
    const lim = { ...small([{}, {}]), timeLimits: [{ key: 'a', name: 'Compounding to filtration', from: { step: 's0/t0', at: 'end' as const }, to: { step: 's1/t0', at: 'start' as const }, hours: 10, validatedMaxHours: 8 }] };
    expect(masterChecks(lim).map((p) => p.message).join('|')).toMatch(/Compounding to filtration: 10 h is longer than its validated maximum \(8 h\)/);
  });
  it('on the floor the shorter of the hold time and the validated maximum runs', () => {
    const doc = small([{ produces: { name: 'bulk', holdHours: 120, validatedMaxHours: 2 } }, { uses: ['s0'] }]);
    expect(timers(doc, done, at(60))).toMatchObject([{ id: 'hold:0:1', from: at(10), at: at(130) }]);
    const none = small([{ produces: { name: 'bulk', holdHours: 2 } }, { uses: ['s0'] }]);
    expect(timers(none, done, at(60))).toMatchObject([{ at: at(130) }]);
  });
});
