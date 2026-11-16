import { stepLabel } from '../../../shared/engine/batch.js';
import { blockOf, stepOf, tone, valueText, words, type BatchDetail, type Block, type StepRow } from '../api-floor.js';

// What QA reads before releasing a sterile batch (plan 4d), in one place: every cycle, filter test, clean-air result,
// intervention, container-closure check, inspection and reconciliation recorded in the batch, each with its checks.
// Read from the batch as recorded; nothing new is kept. Out of limits shows red, as in the review below it.
const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Sterilisation and depyrogenation cycles', ids: ['terminal-sterilise', 'heat-treatment', 'irradiation', 'sterilise', 'depyrogenate', 'isolator-decon', 'lyo-cycle'] },
  { title: 'Sterile filtration and filter tests', ids: ['filter-test', 'filtration'] },
  { title: 'Clean air and microbiology', ids: ['em-filling', 'incubated-results', 'room-status'] },
  { title: 'Interventions and stoppages', ids: ['interventions'] },
  { title: 'Container closure', ids: ['seal-check', 'leak-test-100', 'headspace-gas', 'plunger-check', 'chamber-seal'] },
  { title: 'Inspection', ids: ['visual-inspect', 'aql-sample'] },
  { title: 'Reconciliation of units', ids: ['unit-reconcile'] },
];

export function SterileSummary({ d, blocks }: { d: BatchDetail; blocks: Block[] }) {
  const doc = d.master.doc;
  const idOf = (s: StepRow) => stepOf(doc, s.key).block.id;
  const inMaster = (ids: string[]) => doc.stages.some((st) => st.steps.some((t) => ids.includes(t.block.id)));
  const groups = GROUPS.filter((g) => inMaster(g.ids));
  if (!groups.length) return null;
  return (
    <section className="dash-panel" aria-label="Sterility assurance">
      <div className="panel-head"><h2>Sterility assurance</h2><span className="muted">every cycle, filter test, clean-air result, intervention, closure check, inspection and reconciliation of the batch</span></div>
      {groups.map((g) => {
        const rows = d.steps.filter((s) => g.ids.includes(idOf(s)) && s.events.length > 0);
        return (
          <div key={g.title}>
            <h3>{g.title}</h3>
            {rows.length ? (
              <ul className="rv-list">{rows.map((s) => {
                const block = blockOf(blocks, stepOf(doc, s.key));
                const checks = Object.entries(s.results).filter(([, r]) => r.ok && r.check);
                const bad = checks.some(([, r]) => tone(r) === 'bad');
                // A log entry (an intervention) is told by its values; a check by its results.
                const said = checks.length ? checks.map(([k, r]) => `${block?.calcs.find((c) => c.name === k)?.label ?? k}: ${words(r.ok ? r.check!.shown : '')}`)
                  : (block?.fields ?? []).filter((f) => s.values[f.name] !== undefined).slice(0, 4).map((f) => `${f.label}: ${valueText(s.values[f.name])}`);
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
