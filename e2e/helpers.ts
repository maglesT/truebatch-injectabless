import { expect, type Page } from '@playwright/test';

// Sign-on goes through Medhanta core; the test server's stand-in signs in whoever login_hint names.
export async function logIn(page: Page, username: string) {
  await page.goto(`/login?login_hint=${encodeURIComponent(username)}`);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  // The browser goes on to core's sign-out page (here the stand-in's, on the app itself).
  await page.waitForURL(/signed-out=/);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}
