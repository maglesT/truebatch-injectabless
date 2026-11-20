import { expect, test, type Browser, type Page } from '@playwright/test';
import { logIn } from './helpers.js';

// The master designer: a small master built from a skeleton, a master-check problem found and fixed, then the review
// and approval workflow with three people, each in their own browser (TI-02).

async function as(browser: Browser, who: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await logIn(page, who);
  await page.getByRole('button', { name: 'Master records' }).click();
  return page;
}
// Opens the master's review again, as read now.
async function review(page: Page) {
  await page.getByRole('button', { name: '← Master records' }).click();
  await page.getByRole('row', { name: /PRD-001/ }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Review and approval' }).click();
}
// Signing opens core's password window; the stand-in answers at once and the window closes itself.
async function sign(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sign' }).click();
  await expect(dialog).toBeHidden();
}

test('TI-02 build a master from a skeleton, fix a master-check problem, then check, approve and (another QA person) make it effective', async ({ browser }) => {
  const author = await as(browser, 'author1');
  await author.getByRole('button', { name: 'New master' }).click();
  // Master data's bulk products (and those without a kind yet), never a pack.
  await expect(author.locator('.picker .pick-list')).toContainText('PRD-002');
  await expect(author.locator('.picker .pick-list')).not.toContainText('PK-001');
  await author.getByLabel('Product').fill('PRD-001');
  await author.getByRole('button', { name: /PRD-001/ }).click();
  // The liquid header (engine change 1): 100 L at 1.02 g/mL, filled at 10.0 mL.
  await author.getByLabel('Batch size', { exact: true }).fill('100');
  await author.getByLabel('Density').fill('1.02');
  await author.getByLabel('Nominal fill').fill('10.0');
  await author.getByLabel('Fill excess').fill('0.5');
  await author.getByLabel('Route').selectOption('aseptic');
  await expect(author.locator('.calc-note')).toContainText('Expected units: 9523 units');
  // The starting masters of the aseptic route; this one is the bulk only.
  await expect(author.getByText('Starting master: Freeze-dried vials, aseptic')).toBeVisible();
  await expect(author.getByText(/Starting master: .*terminally sterilised/)).toHaveCount(0);
  await author.getByText('Starting master: Bulk solution only (compounding, no filling)').click();
  await author.getByRole('button', { name: 'Create draft' }).click();
  await expect(author.getByRole('heading', { name: 'PRD-001 · Examplol 50 mg/mL injection' })).toBeVisible();

  // The formula: one material, picked from master data, in mg per mL.
  await author.getByRole('button', { name: 'Formula', exact: true }).click();
  await author.getByRole('button', { name: '+ Add a material' }).click();
  await author.getByLabel('Material').fill('Examplol');
  await author.getByRole('button', { name: /MAT-001/ }).click();
  await author.getByLabel('mg per mL of Examplol').fill('50.0');
  await author.getByLabel('Role of Examplol').selectOption('api');
  await expect(author.locator('.formula-table')).toContainText('5.000 kg');

  // The process: 1 stage starting with line clearance (TI-10); the mixing step is removed, leaving 5.
  await author.getByRole('button', { name: 'Process', exact: true }).click();
  await expect(author.locator('.steps-col .olist li').first()).toContainText('Line clearance');
  // Remove and move are there without selecting the step first.
  // A step is removed after the app's own question, as a stage (run 2, G1).
  await author.getByRole('button', { name: 'Remove Mix for a time' }).click();
  const remove = author.getByRole('dialog', { name: 'Remove a step' });
  await expect(remove).toContainText('Remove Mix for a time?');
  await remove.getByRole('button', { name: 'Cancel' }).click();
  await expect(author.locator('.steps-col .olist li')).toHaveCount(6);
  await author.getByRole('button', { name: 'Remove Mix for a time' }).click();
  await remove.getByRole('button', { name: 'Remove the step' }).click();
  await expect(author.locator('.steps-col .olist li')).toHaveCount(5);
  // Two quick moves move the same step twice (by its key, not a stale row number; run 2, G2).
  const titles = () => author.locator('.steps-col .olist li .ol-main b').allTextContents();
  const before = await titles();
  const last = before.at(-1)!.replace(/^\d+\. /, '');
  await author.getByRole('button', { name: `Move ${last} up` }).click();
  await author.getByRole('button', { name: `Move ${last} up` }).click();
  await expect.poll(async () => (await titles())[2]).toBe(`3. ${last}`);
  await author.getByRole('button', { name: `Move ${last} down` }).click();
  await author.getByRole('button', { name: `Move ${last} down` }).click();
  await expect.poll(titles).toEqual(before);
  // The stage yield: its theoretical quantity, used in two sentences, is one input; More options opens per step.
  await author.locator('.steps-col').getByRole('button', { name: /5\. Stage yield/ }).click();
  await expect(author.locator('.settings-col').getByLabel('Theoretical quantity', { exact: true })).toHaveCount(1);
  await author.getByText('More options').click();
  await author.locator('.steps-col').getByRole('button', { name: /3\. Charge/ }).click();
  await expect(author.locator('.settings-col details.more')).not.toHaveAttribute('open');

  // The master check shows what is missing; its link selects the step, and the template sentence takes the input.
  const check = author.getByRole('complementary', { name: 'Master check' });
  await check.getByRole('button', { name: /Target quantity is not set/ }).click();
  await expect(author.getByRole('heading', { name: 'Weigh a material' })).toBeVisible();
  const sentence = author.locator('.sentence', { hasText: 'must be within ±' });
  await sentence.getByLabel('Target quantity').selectOption({ label: 'Examplol' });
  await expect(author.locator('.ex-results')).toContainText('50.0 mg/mL × 100 L = 5.000 kg');
  await expect(check.getByRole('button', { name: /Target quantity is not set/ })).toBeHidden();

  await check.getByRole('button', { name: /Material \(formula line\) is not set/ }).click();
  await author.getByLabel('Material (formula line)').selectOption({ label: 'MAT-001 Examplol' });
  await expect(check.getByRole('button', { name: /Material \(formula line\) is not set/ })).toBeHidden();

  await check.getByRole('button', { name: /What is checked is not set/ }).click();
  await author.getByLabel('What is checked').fill('Temperature of the bulk');
  await author.getByLabel('Unit', { exact: true }).selectOption('°C');
  await author.getByLabel('Limits: lowest').fill('20');
  await author.getByLabel('Limits: highest').fill('25');
  await expect(check).toContainText('No problems');
  await expect(author.getByRole('status')).toHaveText('All changes saved');

  // Sent for review: the author signs "prepared".
  await author.getByRole('button', { name: 'Review and approval' }).click();
  await expect(author.locator('.plain-view')).toContainText('The net weight must be within ± 0.5 % of the batch quantity of Examplol.');
  await author.getByRole('button', { name: 'Send for review' }).click();
  await sign(author);
  await expect(author.locator('.d-title')).toContainText('In review');

  // A second person returns it with a long reason, then checks it once sent again, in their own browser.
  const checker = await as(browser, 'mcheck1');
  await checker.getByRole('row', { name: /PRD-001/ }).getByRole('button', { name: 'Open' }).click();
  await checker.getByRole('button', { name: 'Return to the author' }).click();
  await checker.getByLabel('Reason').fill(`Returned for the re-test: ${'the approval under a change control of another product was tried and must be refused, '.repeat(5)}see QMS/change-controls/CC-2026-0007/approval-history/without-a-single-break-in-this-long-reference-to-the-record.`);
  await checker.getByRole('dialog').getByRole('button', { name: 'Return' }).click();
  await expect(checker.locator('.timeline')).toContainText('Returned to the author');
  await review(author);
  await author.getByRole('button', { name: 'Send for review' }).click();
  await sign(author);
  await expect(author.locator('.d-title')).toContainText('In review');
  await review(checker);
  await checker.getByRole('button', { name: 'Pass the check' }).click();
  await sign(checker);
  await expect(checker.locator('.timeline')).toContainText('Checked (passed) · MCHECK1');

  // QA approves with a change control number, then makes it effective. At 1366×900 the review history with the long
  // reason wraps in its column: nothing lies over the Approve button.
  const qa = await as(browser, 'qa1', { width: 1366, height: 900 });
  await qa.getByRole('row', { name: /PRD-001/ }).getByRole('button', { name: 'Open' }).click();
  const approve = qa.getByRole('button', { name: 'Approve' });
  await expect(qa.locator('.timeline')).toContainText('without-a-single-break');
  const box = (await approve.boundingBox())!;
  expect(await qa.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toBe('Approve');
  const timeline = (await qa.locator('.timeline').boundingBox())!;
  expect(timeline.x + timeline.width).toBeLessThanOrEqual(box.x);
  await approve.click();
  await qa.getByLabel('Change control number').fill('CC-2026-031');
  await qa.getByRole('button', { name: 'Continue to sign' }).click();
  await sign(qa);
  await expect(qa.locator('.d-title')).toContainText('Approved');
  // No QMS link here: the number was typed by hand, so another person makes the version effective.
  await expect(qa.getByRole('button', { name: 'Make effective' })).toBeDisabled();
  await expect(qa.locator('.review-actions')).toContainText('another person makes the version effective');
  const qa2 = await as(browser, 'qa2');
  await qa2.getByRole('row', { name: /PRD-001/ }).getByRole('button', { name: 'Open' }).click();
  await qa2.getByRole('button', { name: 'Make effective' }).click();
  await qa2.getByRole('dialog').getByRole('button', { name: 'Make effective' }).click();
  await expect(qa2.locator('.d-title')).toContainText('Effective');
  await expect(qa2.locator('.timeline')).toContainText('change control CC-2026-031');

  // Display round 21 Nov: on a phone (390 px) the effective master's page, with its "Comment about" list of places,
  // stays within the screen: no sideways page scroll.
  const phone = await as(browser, 'author1', { width: 390, height: 800 });
  await phone.getByRole('row', { name: /PRD-001/ }).getByRole('button', { name: 'Open' }).click();
  await expect(phone.locator('.d-title')).toContainText('Effective');
  await expect(phone.getByLabel('Comment about')).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
