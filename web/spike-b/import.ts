// The way in for a player with no ROM stored yet: the live game's import screen (app.ts
// runImportScreen), drawn on the page's one Stage (lobby.ts pageStage) before the lobby is
// up. PICK ROM opens the file input; a file dropped anywhere on the page is taken too.
// Dev only: `?rom=<absolute path>` pulls a local file through Vite's /@fs/ route, so a
// headless browser can drive the page without a file picker (the e2e specs).

import type { Emulator } from '../src/emu';
import { checkEmerald, isPrePatched } from '../src/rom/emerald';
import { markHowToDue } from '../src/ui/howto-due';
import { TEXT_RED } from '../src/ui/emerald';
import { noticeScreen } from '../src/ui/screens';
import { pageStage } from './lobby';

/** The dev `?rom=` path, or null (never in a production build). */
export function devRomParam(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(location.search).get('rom') : null;
}

/** Asks for the player's ROM until a good one is picked, and stores it on this device. */
export async function importRom(emu: Emulator, footer: string): Promise<void> {
  const devRom = devRomParam();
  // A dev `?rom=` is a test, not a newcomer.
  if (!devRom) markHowToDue(localStorage);
  const stage = pageStage();
  const input = document.getElementById('rom-input') as HTMLInputElement;
  /** Why the last file was not one: said under the question, in red. */
  let error = '';
  stage.show(
    noticeScreen(() => ({
      title: 'HOENN BATTLE ROYALE',
      lines: [
        { text: 'Pick your own POKEMON EMERALD (U) ROM, 16 MiB, or drop it on this page.' },
        { text: 'It stays on this device, in this browser. Nothing is uploaded.' },
        { text: error, id: 'import-error', color: TEXT_RED },
      ],
      buttons: [{ label: 'PICK ROM', id: 'pick-rom', onPress: () => input.click() }],
      containers: [{ id: 'dropzone', cls: 'dropzone' }],
      footer,
    })),
  );
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
