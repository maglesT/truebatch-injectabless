import { describe, expect, it } from 'vitest';
import { plantClock, plantDate, plantText } from '../shared/plant-time.js';
import { valueText } from '../server/batch-record.js';
import { plant } from '../server/pdf.js';
import { plantTime } from '../web/src/api.js';
import { plainClock } from '../web/src/api-floor.js';

// Times are shown in plant time (IST) everywhere, never as raw UTC or ISO text (owner, 15 Nov 2026).
describe('plant time', () => {
  it('a worked line with mixing times reads in plant time, to the minute (17 Nov 2026 run, F20)', () => {
    expect(plantText('2026-11-15T18:23:50Z − 2026-11-15T18:13:19Z = 11 min'))
      .toBe('15 Nov 2026, 23:53 IST − 15 Nov 2026, 23:43 IST = 11 min');
  });

  it('a time read from the Logbook as PostgreSQL text (cleaned on) reads in plant time; a plain date reads as a date, never ISO', () => {
    expect(plantText('2026-11-15 17:38:16.254+00')).toBe('15 Nov 2026, 23:08 IST');
    expect(plantText('MMS lot E26-0001: released, expiry 2029-10-31, retest 2027-04-01')).toBe('MMS lot E26-0001: released, expiry 31 Oct 2029, retest 1 Apr 2027');
    expect(valueText('2026-11-15')).toBe('15 Nov 2026');
    // A lot or batch code that holds a date-like part is left as it is.
    expect(plantText('Lot A-2026-11-15, LOT2026-11-15X, expiry month 2028-10')).toBe('Lot A-2026-11-15, LOT2026-11-15X, expiry month 2028-10');
    expect(valueText('2026-11-15 17:38:16.254+00')).toBe('15 Nov 2026, 23:08 IST');
  });

  it('a date: 31 Oct 2029', () => {
    expect(['2029-10-31', '2026-01-05', 'not a date'].map(plantDate)).toEqual(['31 Oct 2029', '5 Jan 2026', 'not a date']);
  });

  it('one instant, with or without seconds', () => {
    expect(plantClock('2026-11-15T18:30:00Z')).toBe('16 Nov 2026, 00:00 IST');
    expect(plantClock(new Date('2026-11-15T18:30:05Z'), true)).toBe('16 Nov 2026, 00:00:05 IST');
  });

  it('September is "Sep" like every other month, on the screens and in the PDF (never "Sept")', () => {
    const t = '2027-09-30T06:00:00Z';
    expect([plantClock(t), plant(t), plantTime(t), plainClock(t), plantDate('2027-09-30')]).toEqual(['30 Sep 2027, 11:30 IST', '30 Sep 2027, 11:30 IST', '30 Sep 2027, 11:30 am IST', '30 Sep, 11:30 IST', '30 Sep 2027']);
  });
});
