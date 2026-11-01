// The room painter, /rooms/ (Cam, 11-01: "view a house interior at a time, and place the
// spawn location of items/npcs ... ideally on my phone"). One room on the screen, drawn from
// the ROM on this device as the game draws it, so no art goes on the site. Tap a cell: the
// ball goes there, then the person. It keeps the painting on this device, and COPY or SHARE
// hands over what changed, for tools/br/apply-room-paint.py to write into br_balls.c's table.
// Nothing here reaches a match until then.
import { World, type WorldMap } from '../src/bots/world';
import rooms from './data/rooms.json';
import worldJson from './data/world.json';
import { devRomParam } from './import';
import { loadRom } from './rom';
import { RomArt } from './romart';
import { asTabled, changed, fromDraft, placeable, standable, type Painted, type RoomRow } from './roompaint';

const OBJ_EVENT_GFX_GENTLEMAN = 48;
const OBJ_EVENT_GFX_ITEM_BALL = 59;
const TILE = 16;
const DRAFT = 'hbr:room-paint';
const WHERE = 'hbr:room-paint-at';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (text: string, bad = false) => { const el = $('say'); el.textContent = text; el.classList.toggle('bad', bad); };
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* a private window: this visit only */ } };

const maps = new Map((worldJson as { maps: WorldMap[] }).maps.map((m) => [m.id, m]));
const world = new World([...maps.values()]);
// The houses first, as the table has them, then the caves' and towers' floors.
const rows = (rooms as RoomRow[]).filter((r) => maps.has(r[0]));
const paint = fromDraft(stored(DRAFT), rows);
const nameOf = (id: string) => id.replace(/^MAP_/, '').replace(/_/g, ' ');

async function boot(): Promise<void> {
  const devRom = devRomParam();
  const files = await loadRom($<HTMLCanvasElement>('emu'), say, async (emu) => {
    if (!devRom) { say('Open the game once on this device, so your ROM is here, then come back.', true); throw new Error('no ROM'); }
    await emu.importRom(new Uint8Array(await (await fetch(`/@fs/${devRom}`)).arrayBuffer()));
  }, devRom);
  start(new RomArt(files.rom, files.sym));
}

function start(art: RomArt): void {
  const canvas = $<HTMLCanvasElement>('grid');
  const ctx = canvas.getContext('2d')!;
  const select = $<HTMLSelectElement>('room');
  const ball = art.sprite(OBJ_EVENT_GFX_ITEM_BALL, 1);
  const person = art.sprite(OBJ_EVENT_GFX_GENTLEMAN, 1);
  rows.forEach((r, i) => select.add(new Option(`${r[3] ? '' : 'Floor: '}${nameOf(r[0])}`, String(i))));
  let at = Math.max(0, Math.min(rows.length - 1, Number(stored(WHERE)) || 0));
  let mode: 'item' | 'person' = 'item';

  const row = () => rows[at];
  const map = () => maps.get(row()[0])!;
  const current = (): Painted => paint.get(row()[0]) ?? asTabled(row());
  const count = () => Object.keys(changed(rows, paint)).length;

  const setMode = (m: 'item' | 'person') => {
    mode = m;
    $('item-mode').setAttribute('aria-pressed', String(m === 'item'));
    $('person-mode').setAttribute('aria-pressed', String(m === 'person'));
    draw();
  };
  const tell = () => {
    const c = current();
    const n = count();
    say(`${at + 1} of ${rows.length}. ${c.item ? `Item ${c.item.join(',')}` : 'No item'}, person ${c.person.join(',')}. ${n} room${n === 1 ? '' : 's'} changed.`);
    $<HTMLButtonElement>('copy').disabled = $<HTMLButtonElement>('share').disabled = n === 0;
    $('no-item').textContent = c.item ? 'No item' : 'Item here';
  };
  const save = () => store(DRAFT, JSON.stringify(Object.fromEntries(paint)));

  function draw(): void {
    const m = map();
    const look = art.map(m.group, m.num);
    canvas.width = m.w * TILE;
    canvas.height = m.h * TILE;
    canvas.style.display = 'block';
    // Fills what the stage has, whichever way the room is longer.
    const stage = $('stage');
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
    canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(look.ground, 0, 0);
    ctx.drawImage(look.cover, 0, 0);
    // What a tap cannot reach, dimmed.
    const stand = standable(world, m);
    ctx.fillStyle = 'rgba(0, 0, 0, .55)';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!placeable(m, stand, x, y)) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    const c = current();
    const mark = ([x, y]: [number, number], img: HTMLCanvasElement, color: string, on: boolean) => {
      ctx.drawImage(img, x * TILE, y * TILE + TILE - img.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
    };
    mark(c.person, person, '#4fb3ff', mode === 'person');
    if (c.item) mark(c.item, ball, '#ff5a4f', mode === 'item');
    tell();
  }

  const go = (i: number) => {
    at = (i + rows.length) % rows.length;
    store(WHERE, String(at));
    select.value = String(at);
    setMode('item');
  };

  canvas.addEventListener('click', (e) => {
    const box = canvas.getBoundingClientRect();
    const m = map();
    const x = Math.floor(((e.clientX - box.left) / box.width) * m.w), y = Math.floor(((e.clientY - box.top) / box.height) * m.h);
    if (!placeable(m, standable(world, m), x, y)) { say(`${x},${y}: nobody could reach that.`, true); return; }
    const c = current();
    if (mode === 'item') {
      if (c.person[0] === x && c.person[1] === y) { say('The person stands there.', true); return; }
      paint.set(row()[0], { ...c, item: [x, y] });
      save();
      setMode('person'); // the next tap is the person's: a room is two taps
    } else {
      if (c.item && c.item[0] === x && c.item[1] === y) { say('The item is there.', true); return; }
      paint.set(row()[0], { ...c, person: [x, y] });
      save();
      draw();
    }
  });
  $('prev').addEventListener('click', () => go(at - 1));
  $('next').addEventListener('click', () => go(at + 1));
  select.addEventListener('change', () => go(Number(select.value)));
  $('item-mode').addEventListener('click', () => setMode('item'));
  $('person-mode').addEventListener('click', () => setMode('person'));
  $('no-item').addEventListener('click', () => {
    const c = current();
    const tabled = asTabled(row());
    paint.set(row()[0], { ...c, item: c.item ? null : tabled.item ?? nearDoor(map(), c.person) });
    save();
    draw();
  });
  $('reset').addEventListener('click', () => { paint.delete(row()[0]); save(); draw(); });
  // A line a room: short enough to paste from a phone.
  const file = () => `{\n${Object.entries(changed(rows, paint)).map(([id, p]) => `${JSON.stringify(id)}:${JSON.stringify(p)}`).join(',\n')}\n}\n`;
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(file()); say(`Copied ${count()} rooms. Paste them to Claude.`); }
    catch { say('This browser would not copy. Try Share.', true); }
  });
  $('share').addEventListener('click', async () => {
    const f = new File([file()], 'room-paint.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f] }); } catch { /* the sheet was closed */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  addEventListener('resize', draw);
  (window as unknown as { __rooms: unknown }).__rooms = { get at() { return at; }, get mode() { return mode; }, current, count, file, tile: () => { const b = canvas.getBoundingClientRect(); return { left: b.left, top: b.top, size: b.width / map().w }; } };
  go(at);
}

/** Somewhere for a ball that had no cell: a cell that can hold one, not the person's. */
function nearDoor(m: WorldMap, taken: readonly [number, number]): [number, number] {
  const stand = standable(world, m);
  for (const k of stand) {
    const [x, y] = k.split(',').map(Number);
    if ((x !== taken[0] || y !== taken[1]) && placeable(m, stand, x, y)) return [x, y];
  }
  return [taken[0], taken[1]];
}

void boot().catch((e) => { if (String(e).indexOf('no ROM') < 0) say(`Could not read the ROM: ${String(e)}`, true); });
