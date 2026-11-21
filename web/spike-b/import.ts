// The way in for a player with no ROM stored yet. What they see first is the main menu
// itself (lobby.ts mainMenuRows), every tile there, with PICK YOUR ROM under it: the game
// is right here, it only needs the cartridge (Cam, 11-21: the old screen was a wall of
// words and read as one). A tile asks for the ROM in a sentence or two; DISCORD works as it
// is. A file dropped anywhere on the page is taken too.
// Dev only: `?rom=<absolute path>` pulls a local file through Vite's /@fs/ route, so a
// headless browser can drive the page without a file picker (the e2e specs).

import type { Emulator } from '../src/emu';
import { checkEmerald, isPrePatched } from '../src/rom/emerald';
import { howToRead, markHowToDue } from '../src/ui/howto-due';
import { TEXT_RED } from '../src/ui/emerald';
import { menuScreen, noticeScreen } from '../src/ui/screens';
import type { DrawnScreen } from '../src/ui/stage';
import { DISCORD_INVITE } from '../src/match/lobby';
import { mainMenuRows, pageStage } from './lobby';

/** The dev `?rom=` path, or null (never in a production build). */
export function devRomParam(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(location.search).get('rom') : null;
}

/** Asks for the player's ROM until a good one is picked, and stores it on this device. */
export async function importRom(emu: Emulator): Promise<void> {
  const devRom = devRomParam();
  // A dev `?rom=` is a test, not a newcomer.
  if (!devRom) markHowToDue(localStorage);
  const stage = pageStage();
  const input = document.getElementById('rom-input') as HTMLInputElement;
  /** Why the last file was not one: said under the question, in red. */
  let error = '';
  const pick = () => input.click();
  // One step first: what a tile says before there is a ROM to play it on.
  const ask: DrawnScreen = noticeScreen(() => ({
    title: 'ONE STEP FIRST',
    lines: [
      { text: 'HOENN BATTLE ROYALE plays on your own POKEMON EMERALD (U) ROM, a 16 MiB .gba file.' },
      { text: 'Pick it once. It stays in this browser on this device and is never uploaded.' },
      { text: error, id: 'import-error', color: TEXT_RED },
    ],
    buttons: [
      { label: 'PICK ROM', id: 'pick-rom-ask', onPress: pick },
      { label: 'BACK', id: 'pick-rom-back', onPress: () => stage.pop() },
    ],
    onBack: () => stage.pop(),
  }));
  const landing: DrawnScreen = menuScreen(() => ({
    title: 'HOENN BATTLE ROYALE',
    // The menu as it will be: no pictures yet, they are cut from the ROM (art/pictures.ts).
    rows: mainMenuRows('up').map((r) => ({
      label: r.label,
      id: r.id?.replace(/^lobby-/, 'landing-'),
      onPress: r.action.kind === 'discord' ? () => window.open(DISCORD_INVITE, '_blank', 'noopener') : () => stage.push(ask),
      ...(r.action.kind === 'howto' && !howToRead(localStorage) ? { badge: true } : {}),
    })),
    rowsId: 'landing-rows',
    tiles: true,
    note: error || 'Free, in your browser. Bring your own POKEMON EMERALD (U) ROM to play.',
    noteId: 'import-note',
    buttons: [{ label: 'PICK YOUR ROM', id: 'pick-rom', onPress: pick }],
    containers: [{ id: 'dropzone', cls: 'dropzone' }],
  }));
  stage.show(landing);
  const dragover = (e: DragEvent) => e.preventDefault();
  let drop: ((e: DragEvent) => void) | null = null;
  const bytes = await new Promise<Uint8Array>((resolve) => {
    const handle = async (file: File) => {
      error = '';
      stage.redraw();
      const got = new Uint8Array(await file.arrayBuffer());
      // A local build: dev runs it without a patch (loadRom).
      if (import.meta.env.DEV && isPrePatched(got)) { resolve(got); return; }
      const result = await checkEmerald(got);
      if (!result.ok) { error = result.reason ?? 'not a Pokemon Emerald (U) ROM, 16 MiB'; stage.redraw(); return; }
      resolve(got);
    };
    input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void handle(f); });
    // Picked before this listener existed (app.ts says why it matters on a slow line).
    if (input.files?.[0]) void handle(input.files[0]);
    if (devRom) {
      void fetch(`/@fs/${devRom}`)
        .then(async (r) => handle(new File([await r.arrayBuffer()], 'dev.gba')))
        .catch((e) => { error = `dev ROM: ${String(e)}`; stage.redraw(); });
    }
    drop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) void handle(f); };
    addEventListener('dragover', dragover);
    addEventListener('drop', drop);
  });
  removeEventListener('dragover', dragover);
  if (drop) removeEventListener('drop', drop);
  stage.hide();
  await emu.importRom(bytes);
}
