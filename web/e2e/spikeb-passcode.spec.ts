// A passcoded room on spike B asks again for a wrong passcode, and asks first when JOIN BY
// CODE reaches a locked one (parity t3 5), as /classic/ does (passcode.spec.ts): the page
// used to drop the guest back on the menu with "That is not room X's passcode."
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** A hosted room with its door on a passcode, and its code. */
async function lockedRoom(host: import('@playwright/test').Page, pass: string): Promise<string> {
  await host.goto(`/?rom=${romHashParam()}#host`);
  await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
  const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
  if (!code) throw new Error('could not parse a room code');
  // LISTED, UNLISTED, then the passcode on the drawn entry.
  const door = host.locator('#room-door');
  await expect(door).toHaveText('LISTED', { timeout: 30_000 });
  await door.click();
  await expect(door).toHaveText('UNLISTED', { timeout: 15_000 });
  await door.click();
  await expect(host.locator('#entry-text')).toBeVisible();
  await host.keyboard.type(pass);
  await host.keyboard.press('Enter');
  await expect(door).toHaveText(`PASS ${pass}`, { timeout: 15_000 });
  return code;
}

test('a wrong passcode is asked again, and the right one seats the guest', async ({ browser }) => {
  test.setTimeout(180_000);
  const [hc, gc] = [await browser.newContext(), await browser.newContext()];
  try {
    const host = await hc.newPage();
    const code = await lockedRoom(host, 'AB23');
    const guest = await gc.newPage();
    await guest.goto(`/?rom=${romHashParam()}`);
    const lobbies = guest.locator('#lobby-rows button', { hasText: 'LOBBIES' });
    await expect(lobbies).toBeEnabled({ timeout: 90_000 });
    await lobbies.click();
    const row = guest.locator('#lobby-rooms button').first();
    await expect(row).toContainText('PASS', { timeout: 30_000 });
    await row.click();
    await expect(guest.locator('#entry-title')).toHaveText('PASSCODE');
    await guest.keyboard.type('ZZZZ');
    await guest.keyboard.press('Enter');
    // Refused: asked again and told why, not sent back to the menu.
    await expect(guest.locator('#entry-note')).toHaveText('WRONG PASSCODE', { timeout: 60_000 });
    await expect(guest.locator('#entry-title')).toHaveText('PASSCODE');
    await guest.keyboard.type('AB23');
    await guest.keyboard.press('Enter');
    await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 60_000 });
    await expect(host.locator('#room-roster li')).toHaveCount(2, { timeout: 30_000 });
  } finally {
    await gc.close();
    await hc.close();
  }
});

test('JOIN BY CODE into a locked room asks for its passcode first', async ({ browser }) => {
  test.setTimeout(180_000);
  const [hc, gc] = [await browser.newContext(), await browser.newContext()];
  try {
    const host = await hc.newPage();
    const code = await lockedRoom(host, 'WXYZ');
    const guest = await gc.newPage();
    await guest.goto(`/?rom=${romHashParam()}`);
    const join = guest.locator('#lobby-rows button', { hasText: 'JOIN BY CODE' });
    await expect(join).toBeEnabled({ timeout: 90_000 });
    await join.click();
    await guest.keyboard.type(code);
    await guest.keyboard.press('Enter');
    await expect(guest.locator('#entry-title')).toHaveText('PASSCODE', { timeout: 60_000 });
    await expect(guest.locator('#entry-note'), 'asked, not told it was wrong').toContainText('locked');
    await guest.keyboard.type('WXYZ');
    await guest.keyboard.press('Enter');
    await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 60_000 });
    await expect(host.locator('#room-roster li')).toHaveCount(2, { timeout: 30_000 });
  } finally {
    await gc.close();
    await hc.close();
  }
});
