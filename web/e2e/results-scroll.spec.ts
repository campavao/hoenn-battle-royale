// The results' standings under a finger (HBR-91, Cam's 10-29 play-test): 65 rows on a
// phone, and a swipe, the wheel or a tap on an arrow moved none of them. The list's
// <div> sat straight under #ui-hits, whose `> div` rule lets every touch through to the
// canvas. The screen is mounted on each page's own stage, in each page's own CSS, with
// no ROM: what is tested is what the finger lands on and whether the list moves.
import { test, expect, type Page } from '@playwright/test';

const PHONE = { width: 390, height: 844 };

async function showResults(page: Page, path: string): Promise<void> {
  // The page's own script never runs: its CSS and its #stage are what is under test.
  await page.route(/\/(src\/app|spike-b\/main)\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(path);
  await page.waitForSelector('#ui-hits', { state: 'attached' });
  await page.evaluate(async () => {
    const { Stage } = await import('/src/ui/stage.ts');
    const { resultsScreen } = await import('/src/ui/results.ts');
    const $ = (id: string) => document.getElementById(id)!;
    // Only the stage: the rest of the page stays out of the finger's way.
    for (const el of document.querySelectorAll<HTMLElement>('body > *')) if (!el.contains($('stage')) && el.id !== 'stage-fade') el.style.display = 'none';
    $('stage').hidden = false;
    const standings = Array.from({ length: 65 }, (_, i) => ({ place: `${i + 1}th`, name: `T${i + 1}`, me: i === 56 }));
    const model = {
      view: { headline: '57th of 65', line: '57th of 65 · survived 3:00', survived: '3:00' },
      fame: null,
      standings,
      record: [{ label: 'RINGS', value: '2' }],
      again: { label: 'PLAY AGAIN', id: 'results-again', onPress() {} },
      menu() {},
    };
    new Stage($('stage'), $('ui') as HTMLCanvasElement, $('ui-hits'), $('stage-fade')).show(resultsScreen(() => model));
  });
  await page.waitForSelector('#results-standings', { state: 'attached' });
}

/** The canvas, as a number: it changes when the list does. */
const picture = (page: Page) =>
  page.evaluate(() => {
    const d = (document.getElementById('ui') as HTMLCanvasElement).toDataURL();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
    return h;
  });

for (const path of ['/', '/classic/']) {
  test(`${path}: a finger, an arrow and the wheel each move the standings`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await showResults(page, path);
    const box = (await page.locator('#results-standings').boundingBox())!;
    const cx = box.x + box.width / 2;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [cx, box.y + box.height / 2]), 'the finger lands on the list').toBe('results-standings');

    // It opens at our own 57th, so there is a page above: swipe down to see it.
    let was = await picture(page);
    const cdp = await ctx.newCDPSession(page);
    const y0 = box.y + box.height * 0.2;
    const y1 = box.y + box.height * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: y0 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: y0 + ((y1 - y0) * i) / 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => picture(page), 'a swipe moves it').not.toBe(was);

    // A tap well after the swipe (a quick second touch is a double tap to the browser).
    await page.waitForTimeout(800);
    was = await picture(page);
    await page.locator('#results-down').tap();
    await expect.poll(() => picture(page), 'the down arrow turns a page').not.toBe(was);
    await expect(page.locator('#results-again'), 'the buttons stay on the phone').toBeInViewport({ ratio: 1 });
    await ctx.close();

    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await showResults(desk, path);
    const d = (await desk.locator('#results-standings').boundingBox())!;
    was = await picture(desk);
    await desk.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await desk.mouse.wheel(0, -200);
    await expect.poll(() => picture(desk), 'the wheel moves it').not.toBe(was);
    await desk.close();
  });
}
