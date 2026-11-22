import { notYetText, stepLabel } from '../../../shared/engine/batch.js';
import { plantText } from '../../../shared/plant-time.js';
import { blockOf, stepOf, tone, valueText, words, type BatchDetail, type Block, type StepRow } from '../api-floor.js';

// What QA reads before releasing a sterile batch (plan 4d), in one place: every cycle, filter test, clean-air result,
// intervention, container-closure check, inspection and reconciliation recorded in the batch, each with its checks.
// Read from the batch as recorded; nothing new is kept. Out of limits shows red, as in the review below it.
const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Sterilisation and depyrogenation cycles', ids: ['terminal-sterilise', 'heat-treatment', 'irradiation', 'sterilise', 'depyrogenate', 'isolator-decon', 'lyo-cycle'] },
  { title: 'Sterile filtration and filter tests', ids: ['filter-test', 'filtration'] },
  { title: 'Aseptic set-up (isolator, RABS or BFS machine)', ids: ['aseptic-ready'] },
  // Run 3, H13: the fill itself (fill weights each round; the powder fill's humidity, the BFS parison temperature and air shower check).
  { title: 'Filling', ids: ['fill', 'ffs-run', 'powder-fill'] },
  { title: 'Clean air and microbiology', ids: ['em-filling', 'incubated-results', 'room-status'] },
  { title: 'Interventions and stoppages', ids: ['interventions'] },
  { title: 'Container closure', ids: ['seal-check', 'leak-test-100', 'headspace-gas', 'plunger-check', 'chamber-seal'] },
  { title: 'Inspection', ids: ['visual-inspect', 'aql-sample'] },
  { title: 'Reconciliation of units', ids: ['unit-reconcile'] },
];

/** A duration the library shows cut short ("0.0002777… h") reads in minutes or seconds under 1, at most 2 decimals. */
export const shortTime = (t: string) => t.replace(/(\d+\.\d+)… (h|min)\b( rounded to)?/g, (_, n: string, u: string, rounded?: string) => {
  let v = Number(n), unit = u;
  if (unit === 'h' && v < 1) { v *= 60; unit = 'min'; }
  if (unit === 'min' && v < 1) { v *= 60; unit = 's'; }
  return `about ${Number(v.toFixed(2))} ${unit}${rounded ? (unit === u ? rounded : `; in ${u} rounded to`) : ''}`;
});

/** One step's line: its checks (or, for a log entry, its values) in words, and whether any is out of limits. A round
 *  followed by another has its stop check not passed yet: that is the rounds going on, not out of limits. */
export function summaryOf(s: StepRow, block: Block | undefined): { bad: boolean; said: string[] } {
  const checks = Object.entries(s.results).filter(([, r]) => r.ok && r.check);
  const bad = checks.some(([k, r]) => tone(r) === 'bad' && k !== s.notYet);
  // The machines the step used (the isolator or RABS, the capping machine …) with their Logbook status as the step
  // recorded it at use (run 2, G8); nothing new is kept.
  const machines = (block?.fields ?? []).filter((f) => f.kind === 'machine' && s.values[f.name] !== undefined).map((f) => {
    const src = s.source?.[f.name];
    return `${f.label}: ${valueText(s.values[f.name])}${!src ? '' : src.from === 'hand' ? ` (Logbook ${src.state === 'down' ? 'down' : 'not linked'} at use: its status answered by hand)` : ` (Logbook at use: ${src.shown})`}`;
  });
  return { bad, said: [...machines, ...mediaFill(s), ...said(s, block, checks)] };
}
/** The aseptic set-up's line media fill in words: its report, outcome and next date as Qualification gave them, or typed. */
function mediaFill(s: StepRow): string[] {
  if (s.values.apsReport === undefined) return [];
  const src = s.source?.apsReport;
  if (src && src.from !== 'hand') return [`Line media fill ${plantText(src.shown).replace(/^Qualification media fill /, '')} (Qualification)`];
  return [`Line media fill ${valueText(s.values.apsReport)} (typed by hand)${s.values.apsDue !== undefined ? `, next due ${valueText(s.values.apsDue)}` : ''}`];
}
function said(s: StepRow, block: Block | undefined, checks: [string, StepRow['results'][string]][]): string[] {
  return checks.length ? checks.map(([k, r]) => {
      const label = block?.calcs.find((c) => c.name === k)?.label ?? k;
      const shown = shortTime(words(r.ok ? (k === s.notYet ? notYetText(r.check!.shown) : r.check!.shown) : ''));
      // The worked line often starts with the check's own name: say it once.
      return shown.startsWith(`${label}: `) ? shown : `${label}: ${shown}`;
    })
    : (block?.fields ?? []).filter((f) => f.kind !== 'machine' && s.values[f.name] !== undefined).slice(0, 4).map((f) => `${f.label}: ${valueText(s.values[f.name])}`);
}

export function SterileSummary({ d, blocks }: { d: BatchDetail; blocks: Block[] }) {
  const doc = d.master.doc;
  const idOf = (s: StepRow) => stepOf(doc, s.key).block.id;
  const inMaster = (ids: string[]) => doc.stages.some((st) => st.steps.some((t) => ids.includes(t.block.id)));
  const groups = GROUPS.filter((g) => inMaster(g.ids));
  if (!groups.length) return null;
  return (
    <section className="dash-panel" aria-label="Sterility assurance">
      <div className="panel-head"><h2>Sterility assurance</h2><span className="muted">every cycle, the isolator or RABS, filter test, fill, clean-air result, intervention, closure check and capping machine, inspection and reconciliation of the batch</span></div>
      {groups.map((g) => {
        const rows = d.steps.filter((s) => g.ids.includes(idOf(s)) && s.events.length > 0);
        return (
          <div key={g.title}>
            <h3>{g.title}</h3>
            {rows.length ? (
              <ul className="rv-list">{rows.map((s) => {
                const { bad, said } = summaryOf(s, blockOf(blocks, stepOf(doc, s.key)));
                return (
                  <li key={s.id} className={bad ? 'bad' : 'ok'}><b>{stepLabel(doc, s.key)}</b><span>{said.join(' · ') || 'Nothing recorded yet'}</span>
                    <small>{['done', 'checked'].includes(s.state) ? (bad ? 'out of limits' : 'signed') : 'not finished'}</small></li>
                );
              })}</ul>
            ) : <p className="muted rv-none">None recorded.</p>}
          </div>
        );
      })}
    </section>
  );
}
