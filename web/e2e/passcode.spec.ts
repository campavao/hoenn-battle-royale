// A passcoded room lets in whoever has the code (POK-320). The page used to drop the
// code a guest typed: the lobby's locked row joined with none, and the relay's
// `passcode` refusal was a dead end, so nobody could get into a passcoded room from the
// web at all. Kanto asks before it knocks and says WRONG PASSCODE on a refusal
// (browse.lua); the host sees the code on its own door (menu.lua's OPEN: PASS 1234).
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a guest gets into a passcoded room with the code, and is asked again for a wrong one', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&noauto&nobots&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    // The host locks the door: LISTED, UNLISTED, then the passcode on the drawn entry.
    const door = host.locator('#room-door');
    await expect(door).toHaveText('LISTED', { timeout: 30_000 });
    await door.click();
    await expect(door).toHaveText('UNLISTED', { timeout: 15_000 });
    await door.click();
    await expect(host.locator('#entry-text')).toBeVisible();
    await host.keyboard.type('AB23');
    await host.keyboard.press('Enter');
    // ...and reads it back off the door, to tell whoever it is for.
    await expect(door).toHaveText('PASS AB23', { timeout: 15_000 });

    // A guest finds it on LOBBIES, marked, and knocks with the wrong code.
    const guest = await guestCtx.newPage();
    await guest.goto(`/#rom=${rom}`);
    const lobbies = guest.locator('#lobby-rows button', { hasText: 'LOBBIES' });
    await expect(lobbies).toBeEnabled({ timeout: 60_000 });
    await lobbies.click();
    const row = guest.locator('#lobby-rooms button').first();
    await expect(row).toContainText('PASS', { timeout: 30_000 });
    await row.click();
    await expect(guest.locator('#entry-title')).toHaveText('PASSCODE');
    await guest.keyboard.type('ZZZZ');
    await guest.keyboard.press('Enter');

    // Refused: asked again, told why, and still not in the room.
    await expect(guest.locator('#entry-note')).toHaveText('WRONG PASSCODE', { timeout: 60_000 });
    await expect(host.locator('#room-roster li')).toHaveCount(1);
    // The passcode is never in the link.
    expect(new URL(guest.url()).hash).not.toContain('ZZZZ');

    // The right one seats them.
    for (let i = 0; i < 4; i++) await guest.keyboard.press('Backspace');
    await guest.keyboard.type('AB23');
    await guest.keyboard.press('Enter');
    await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 60_000 });
    await expect(host.locator('#room-roster li')).toHaveCount(2, { timeout: 30_000 });
    expect(new URL(guest.url()).hash).not.toContain('AB23');
  } finally {
    await guestCtx.close();
    await hostCtx.close();
  }
});

test('JOIN BY CODE into a passcoded room asks for the passcode, and the code gets in', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&noauto&nobots&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    const door = host.locator('#room-door');
    await expect(door).toHaveText('LISTED', { timeout: 30_000 });
    await door.click();
    await expect(door).toHaveText('UNLISTED', { timeout: 15_000 });
    await door.click();
    await expect(host.locator('#entry-text')).toBeVisible();
    await host.keyboard.type('WXYZ');
    await host.keyboard.press('Enter');
    await expect(door).toHaveText('PASS WXYZ', { timeout: 15_000 });

    // The code on the entry, and the relay's `passcode` refusal is a question, not a dead end.
    const guest = await guestCtx.newPage();
    await guest.goto(`/#rom=${rom}`);
    const join = guest.locator('#lobby-rows button', { hasText: 'JOIN BY CODE' });
    await expect(join).toBeEnabled({ timeout: 60_000 });
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
    await guestCtx.close();
    await hostCtx.close();
  }
});
