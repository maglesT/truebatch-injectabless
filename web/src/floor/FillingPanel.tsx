import { go, plainClock, stepLink, timeLeft, type BatchDetail, type StepRow } from '../api-floor.js';

const finished = (s: StepRow) => ['done', 'checked', 'not_applicable'].includes(s.state);

// The filling screen (plan 4d): in an aseptic stage, the three things the filling room works on side by side, on the
// batch overview and above every step of the stage: the fill-weight checks, the clean-air checks, and "Add
// intervention" always in reach (TI-28). Each card opens its step; nothing here records anything itself.
export function FillingPanel({ d, stage, now, here }: { d: BatchDetail; stage: number; now: number; here?: string }) {
  const s = d.master.doc.stages[stage];
  if (!s?.aseptic) return null;
  const of = (...blockIds: string[]) => {
    const ti = s.steps.findIndex((t) => blockIds.includes(t.block.id));
    if (ti < 0) return null;
    const rows = d.steps.filter((x) => x.key.stage === stage && x.key.step === ti);
    // The round to work on now; one still waiting (an earlier step not done) is not offered.
    const open = rows.find((x) => !finished(x) && x.state !== 'waiting' && !x.blocked);
    const timer = d.timers.find((t) => t.kind === 'periodic' && t.key.stage === stage && t.key.step === ti);
    return { open, timer, done: rows.length > 0 && rows.every(finished) };
  };
  const card = (title: string, blockIds: string[], button: string) => {
    const x = of(...blockIds);
    if (!x) return null;
    const left = x.timer ? Date.parse(x.timer.at) - now : undefined;
    const late = x.timer?.state === 'late' || (left !== undefined && left < 0);
    return (
      <div className={`fill-card${late ? ' bad' : ''}`}>
        <h3>{title}</h3>
        <p className="countdown">{x.done ? 'Finished' : left === undefined ? (x.open ? 'Round open' : 'Not open yet') : late ? 'Overdue' : `Next in ${timeLeft(left)}`}</p>
        {x.timer && !x.done && <small>due {plainClock(x.timer.at)}</small>}
        <button className="big" disabled={!x.open || x.open.id === here} onClick={() => x.open && go(stepLink(d.batch.id, x.open.id))}>{button}</button>
      </div>
    );
  };
  const log = of('interventions');
  return (
    <section className="filling" aria-label="Aseptic filling">
      {card('Fill checks', ['fill', 'fill-suspension', 'ffs-run', 'powder-fill'], 'Open the fill check')}
      {card('Clean-air checks', ['em-filling'], 'Open the clean-air check')}
      {log && (
        <div className="fill-card">
          <h3>Interventions</h3>
          <p className="muted">{d.steps.filter((x) => x.key.stage === stage && finished(x) && s.steps[x.key.step]?.block.id === 'interventions').length} recorded</p>
          <button className="big primary" disabled={!log.open || log.open.id === here} onClick={() => log.open && go(stepLink(d.batch.id, log.open.id))}>Add intervention</button>
        </div>
      )}
    </section>
  );
}
