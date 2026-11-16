import { expect, test, type Page } from '@playwright/test';
import { connect } from '../server/db.js';
import { TEST_DATABASE_URL } from '../test/helpers.js';
import { small } from '../test/engine-fixture.js';
import { E2E_SCHEMA } from './config.js';
import { logIn } from './helpers.js';

// The filling screen (plan 4d): in an aseptic stage, the fill checks, the clean-air checks and "Add intervention" side
// by side, on the batch overview and above every step of the stage. Only an aseptic operator works its steps (TI-23).

const periodic = { flow: { kind: 'repeat-until', maxRounds: 200 }, everyMinutes: 30 };
async function issueBatch(page: Page): Promise<number> {
  await logIn(page, 'iss1');
  // A master that passes the master check (issue refuses one that does not): one aseptic stage of a terminally
  // sterilised product, with every step its route needs.
  const pct = (low: string, high: string) => ({ low, high, unit: '%' });
  const doc = small([{ name: 'Aseptic filling', aseptic: true, roomTypes: ['Blending'], steps: [
    { block: { id: 'line-clearance', version: 1 }, settings: {}, checker: true },
    { block: { id: 'aseptic-ready', version: 1 }, settings: {} },
    { block: { id: 'interventions', version: 1 }, settings: {} },
    { block: { id: 'em-filling', version: 1 }, settings: { particles05Limit: { high: '3520', unit: 'particles/m³' }, particles5Limit: { high: '29', unit: 'particles/m³' } }, ...periodic },
    { block: { id: 'fill', version: 1 }, settings: { needles: '2', band: '2', meanLimit: { low: '1.040', high: '1.060', unit: 'g' }, fillTarget: { header: 'fillTarget' },
      density: { header: 'density' } }, ...periodic },
    { block: { id: 'qa-sample', version: 1 }, settings: { sampleLimit: { low: '20', high: '40', unit: 'units' } } },
    { block: { id: 'seal-check', version: 1 }, settings: { defectLimit: { high: '0', unit: 'units' }, forceUnit: 'N' }, ...periodic },
    { block: { id: 'terminal-sterilise', version: 1 }, settings: { medium: 'moist heat', lethalityLimit: { low: '15', unit: 'min' } } },
    { block: { id: 'visual-inspect', version: 1 }, settings: {} },
    { block: { id: 'unit-reconcile', version: 1 }, settings: { theoretical: { header: 'units' }, yieldLimit: pct('95.0', '100.5'), accountabilityLimit: pct('99.0', '100.5') }, checker: true },
  ] }]);
  doc.header.route = 'terminal';
  doc.header.densityGPerMl = '1.040';
  const m = await page.request.post('/api/masters', { data: { doc } });
  expect(m.ok()).toBe(true);
  const { id } = (await m.json()) as { id: number };
  const owner = connect(TEST_DATABASE_URL, { searchPath: E2E_SCHEMA });
  for (const s of ['in_review', 'approved', 'effective']) await owner`update master_versions set state = ${s} where id = ${id}`;
  await owner.end();
  await page.goto('/');
  await page.getByRole('button', { name: 'Master records' }).click();
  await page.getByRole('row', { name: /PRD-050/ }).last().getByRole('button', { name: 'Issue a batch' }).click();
  await page.getByRole('button', { name: 'Next: sign' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForURL(/#\/batch\/\d+$/);
  return Number(/#\/batch\/(\d+)$/.exec(page.url())![1]);
}

test('TI-28 the filling screen: fill checks, clean-air checks and Add intervention side by side; TI-23 only an aseptic operator works the steps', async ({ browser }) => {
  const issuer = await browser.newPage();
  const id = await issueBatch(issuer);
  await issuer.close();

  // A floor operator who is not an aseptic operator sees the panel but is refused the steps of the aseptic stage.
  const plain = await browser.newPage();
  await logIn(plain, 'op1');
  await plain.goto(`/#/batch/${id}`);
  const panel = plain.getByRole('region', { name: 'Aseptic filling', exact: true });
  await expect(panel).toContainText('Fill checks');
  await expect(panel).toContainText('Clean-air checks');
  await expect(panel).toContainText('Interventions');
  // Before the set-up nothing of the filling is open: the cards say so and their buttons are off.
  await expect(panel.getByRole('button', { name: 'Open the fill check' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Open the clean-air check' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Add intervention' })).toBeDisabled();
  await plain.locator('.steplist').getByRole('button', { name: /Line clearance/ }).first().click();
  // Above every step of the stage the panel stays.
  await expect(plain.getByRole('region', { name: 'Aseptic filling', exact: true })).toBeVisible();
  // The step says why, and offers no start (the server refuses it too, test/sterile-rules.test.ts).
  await expect(plain.getByRole('note').filter({ hasText: 'Only an aseptic operator' })).toBeVisible();
  await expect(plain.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await plain.close();

  // The aseptic operator starts it.
  const op = await browser.newPage();
  await logIn(op, 'asep1');
  await op.goto(`/#/batch/${id}`);
  await op.locator('.steplist').getByRole('button', { name: /Line clearance/ }).first().click();
  await op.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(op.locator('.step-title .chip').first()).toHaveText('In progress');
  if (process.env.SHOTS) await op.screenshot({ path: `${process.env.SHOTS}/filling-screen.png`, fullPage: true });
  await op.close();

  // QA's review lists the sterile record by kind, from the batch as recorded (plan 4d).
  const qa = await browser.newPage();
  await logIn(qa, 'qa1');
  await qa.goto(`/#/release/${id}`);
  const sterile = qa.getByRole('region', { name: 'Sterility assurance' });
  for (const h of ['Sterilisation and depyrogenation cycles', 'Clean air and microbiology', 'Interventions and stoppages', 'Container closure', 'Inspection', 'Reconciliation of units']) {
    await expect(sterile.getByRole('heading', { name: h })).toBeVisible();
  }
  // A kind the master does not have is not listed; nothing is recorded yet.
  await expect(sterile.getByRole('heading', { name: 'Sterile filtration and filter tests' })).toHaveCount(0);
  await expect(sterile.getByText('None recorded.').first()).toBeVisible();
  await qa.close();
});
