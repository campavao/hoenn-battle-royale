import { describe, expect, it, vi } from 'vitest';
import { Mirror, Stage, type Painted, type Widget } from './stage';

// The DOM copy against a fake DOM: just the calls Mirror makes, and a click that goes to
// its target and then up through the parents, the way a browser delivers one.
class FakeNode {
  readonly tagName: string;
  id = '';
  className = '';
  hidden = false;
  disabled = false;
  type = '';
  textContent = '';
  value = '';
  readOnly = false;
  maxLength = -1;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  readonly ownerDocument = fakeDocument;
  private listeners: { type: string; fn: (ev: Record<string, unknown> & { target: FakeNode }) => void }[] = [];

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  addEventListener(type: string, fn: (ev: Record<string, unknown> & { target: FakeNode }) => void): void {
    this.listeners.push({ type, fn });
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  removeAttribute(name: string): void {
    if (name === 'id') this.id = '';
  }

  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    node.parentNode?.removeChild(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }

  appendChild(node: FakeNode): FakeNode {
    return this.insertBefore(node, null);
  }

  removeChild(node: FakeNode): FakeNode {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }

  replaceChildren(): void {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
  }

  click(): void {
    this.dispatch('click');
  }

  /** What typing does: the value changes, then an input event bubbles up. */
  typeIn(value: string): void {
    this.value = value;
    this.dispatch('input');
  }

  /** Any other event, with its fields: a wheel's deltaY, a pointer's clientY. */
  fire(type: string, fields: Record<string, unknown> = {}): void {
    this.dispatch(type, fields);
  }

  private dispatch(type: string, fields: Record<string, unknown> = {}): void {
    for (let n: FakeNode | null = this; n; n = n.parentNode) for (const l of n.listeners) if (l.type === type) l.fn({ preventDefault() {}, ...fields, target: this });
  }

  /** Every element under this one, depth first. */
  all(): FakeNode[] {
    return this.childNodes.flatMap((c) => [c, ...c.all()]);
  }

  under(root: FakeNode): boolean {
    for (let n: FakeNode | null = this; n; n = n.parentNode) if (n === root) return true;
    return false;
  }
}

const fakeDocument = { createElement: (tag: string) => new FakeNode(tag) };

function mirror(typed: () => void = () => {}) {
  const hits = new FakeNode('div');
  const m = new Mirror(hits as unknown as HTMLElement, (w) => w.onPress?.(), typed);
  const sync = (p: Painted) => m.sync(p, 2, 0);
  const byId = (id: string) => hits.all().find((n) => n.id === id)!;
  const byText = (text: string) => hits.all().filter((n) => n.textContent === text);
  return { hits, m, sync, byId, byText };
}

const at = (y: number) => ({ x: 8, y, w: 64, h: 16 });

describe('the drawn screen\'s DOM copy (POK-330 #33)', () => {
  // Cam's 10-26 play-test: the results' standings in one column, scrolled by hand.
  it('a list moves a row per row of wheel or drag, and only the list hears it', () => {
    let redrawn = 0;
    const { sync, byId } = mirror(() => redrawn++);
    const moved: number[] = [];
    sync({
      widgets: [
        { rect: at(0), text: 'standings', id: 'list', scroll: (by) => (moved.push(by), true) },
        { rect: at(100), text: 'PLAY AGAIN', id: 'again', onPress: () => {} },
      ],
    });
    const list = byId('list');
    expect(list.style.touchAction, 'a drag over it is not the page\'s').toBe('none');
    expect(byId('again').style.touchAction).toBe('');
    // At scale 2 a row is 32 CSS pixels: a 100-pixel notch is three, and the rest waits.
    list.fire('wheel', { deltaY: 100, deltaMode: 0 });
    expect(moved).toEqual([3]);
    list.fire('wheel', { deltaY: 30, deltaMode: 0 });
    expect(moved).toEqual([3, 1]);
    list.fire('wheel', { deltaY: -1, deltaMode: 1 });
    expect(moved).toEqual([3, 1, -1]);
    // A finger pulling up 70 pixels shows two rows further down, wherever it wanders.
    list.fire('pointerdown', { pointerId: 7, clientY: 200 });
    byId('again').fire('pointermove', { pointerId: 7, clientY: 130 });
    expect(moved).toEqual([3, 1, -1, 2]);
    // A mouse let go outside the panel: the next move with no button held ends it.
    list.fire('pointerdown', { pointerId: 8, clientY: 200, pointerType: 'mouse', buttons: 1 });
    list.fire('pointermove', { pointerId: 8, clientY: 100, pointerType: 'mouse', buttons: 0 });
    list.fire('pointermove', { pointerId: 8, clientY: 0, pointerType: 'mouse', buttons: 0 });
    expect(moved).toEqual([3, 1, -1, 2]);
    list.fire('pointerup', { pointerId: 7 });
    list.fire('pointermove', { pointerId: 7, clientY: 0 });
    expect(moved, 'nothing after the finger lifts').toHaveLength(4);
    byId('again').fire('wheel', { deltaY: 300, deltaMode: 0 });
    expect(moved, 'a wheel over a button is not the list\'s').toHaveLength(4);
    expect(redrawn).toBe(4);
  });

  it('a repaint keeps the button under the finger, and the tap presses the widget painted now', () => {
    // The room repaints every 500 ms, and a paint hands out fresh widgets with fresh
    // closures. A tap takes 100-200 ms: its pointerdown lands before a repaint and its
    // click after. The element under the finger has to be the same one throughout.
    const { hits, sync, byId } = mirror();
    const pressed: string[] = [];
    const paint = (n: number): Painted => ({
      widgets: [{ rect: at(100), text: 'START', id: 'room-start', onPress: () => pressed.push(`paint ${n}`) }],
    });
    sync(paint(1));
    const start = byId('room-start');
    sync(paint(2));
    expect(byId('room-start'), 'the same element, not a copy').toBe(start);
    expect(start.under(hits), 'still in the page').toBe(true);
    start.click();
    expect(pressed).toEqual(['paint 2']);
  });

  it('a seat that leaves takes its row with it, and the others keep theirs, in order', () => {
    const { hits, sync, byText } = mirror();
    const seat = (name: string, y: number): Widget => ({ rect: at(y), text: name, parent: 'room-roster', onPress: () => {} });
    const containers = [{ id: 'room-roster', tag: 'ul' as const }];
    sync({ containers, widgets: [seat('MAY', 0), seat('WALLY', 16), seat('BRENDAN', 32)] });
    const [may] = byText('MAY');
    const [brendan] = byText('BRENDAN');
    sync({ containers, widgets: [seat('MAY', 0), seat('BRENDAN', 16)] });
    const list = hits.childNodes[0];
    expect(list.tagName).toBe('UL');
    expect(list.childNodes.map((li) => li.tagName)).toEqual(['LI', 'LI']);
    expect(list.childNodes.map((li) => li.childNodes[0])).toEqual([may, brendan]);
    expect(byText('WALLY')).toEqual([]);
    expect(brendan.style.top, 'moved up a row in place').toBe('32px');
  });

  it('two trainers with one name are two buttons, each pressing its own', () => {
    const { sync, byText } = mirror();
    const pressed: number[] = [];
    const seat = (seatNo: number): Widget => ({ rect: at(seatNo * 16), text: 'TRAINER', parent: 'room-roster', onPress: () => pressed.push(seatNo) });
    const p = { containers: [{ id: 'room-roster', tag: 'ul' as const }], widgets: [seat(1), seat(2)] };
    sync(p);
    const first = byText('TRAINER');
    sync(p);
    const again = byText('TRAINER');
    expect(again).toHaveLength(2);
    expect(again).toEqual(first);
    again[1].click();
    expect(pressed).toEqual([2]);
  });

  it('what a button says, whether it can be pressed and where it is change in place', () => {
    const { sync, byId } = mirror();
    let pressed = 0;
    const start = (disabled: boolean, text: string, y: number): Painted => ({
      widgets: [{ rect: at(y), text, id: 'room-start', disabled, onPress: () => pressed++ }],
    });
    sync(start(true, 'START', 100));
    const el = byId('room-start');
    expect(el.disabled).toBe(true);
    el.click();
    expect(pressed, 'a greyed-out START does nothing').toBe(0);
    sync(start(false, 'START!', 120));
    expect(byId('room-start')).toBe(el);
    expect([el.disabled, el.textContent, el.style.top, el.type]).toEqual([false, 'START!', '240px', 'button']);
    el.click();
    expect(pressed).toBe(1);
  });

  it('a line of text is a div and a pressable thing a button, and a change of kind is a new element', () => {
    const { sync, byText } = mirror();
    sync({ widgets: [{ rect: at(0), text: 'OK', cursor: null }] });
    const [line] = byText('OK');
    expect(line.tagName).toBe('DIV');
    sync({ widgets: [{ rect: at(0), text: 'OK', onPress: () => {} }] });
    const [button] = byText('OK');
    expect(button.tagName).toBe('BUTTON');
    expect(byText('OK')).toHaveLength(1);
  });

  it('a hidden container keeps its children for when it shows again; clear takes everything', () => {
    const { hits, m, sync, byId } = mirror();
    const p = (hidden: boolean): Painted => ({
      containers: [{ id: 'room-controls', hidden }],
      widgets: [{ rect: at(0), text: 'FILL 3', id: 'room-fill', parent: 'room-controls', onPress: () => {} }],
    });
    sync(p(false));
    const fill = byId('room-fill');
    sync(p(true));
    expect(byId('room-controls').hidden).toBe(true);
    expect(byId('room-fill')).toBe(fill);
    m.clear();
    expect(hits.childNodes).toEqual([]);
    sync(p(false));
    expect(byId('room-fill'), 'after a clear, a new copy').not.toBe(fill);
  });
});

describe('a field in the copy (POK-428)', () => {
  it('is a textarea holding the value, which a repaint never writes under the typist', () => {
    const { sync, byId } = mirror();
    const typed: string[] = [];
    const paint = (value: string): Painted => ({
      widgets: [{ rect: at(40), text: 'Your feedback', id: 'feedback-text', field: { value, max: 1000, onInput: (t) => typed.push(t) } }],
    });
    sync(paint(''));
    const box = byId('feedback-text') as unknown as { tagName: string; value: string; maxLength: number; attrs: Record<string, string> };
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.maxLength).toBe(1000);
    expect(box.attrs['aria-label']).toBe('Your feedback');
    expect(box.value).toBe('');
    // what was typed is the box's; a repaint with the same value leaves it be
    box.value = 'the ferry';
    sync(paint('the ferry'));
    expect(byId('feedback-text')).toBe(box);
    expect(box.value).toBe('the ferry');
    // the screen emptying it after a send does
    sync(paint(''));
    expect(box.value).toBe('');
  });

  it('hands what is typed to the field painted now, then asks for a repaint', () => {
    let repaints = 0;
    const { sync, byId } = mirror(() => repaints++);
    const typed: string[] = [];
    const paint = (n: number): Painted => ({
      widgets: [{ rect: at(40), text: 'Your feedback', id: 'feedback-text', field: { value: '', max: 1000, onInput: (t) => typed.push(`${n}:${t}`) } }],
    });
    sync(paint(1));
    sync(paint(2));
    (byId('feedback-text') as unknown as { typeIn(v: string): void }).typeIn('lag');
    expect(typed).toEqual(['2:lag']);
    expect(repaints).toBe(1);
  });

  it('is held read-only, never disabled, while the note is on its way', () => {
    const { sync, byId } = mirror();
    sync({ widgets: [{ rect: at(40), text: 'Your feedback', id: 'feedback-text', field: { value: 'hi', max: 1000, readOnly: true, onInput: () => {} } }] });
    const box = byId('feedback-text') as unknown as { readOnly: boolean; disabled: boolean };
    expect(box.readOnly).toBe(true);
    expect(box.disabled).toBe(false);
  });
});

describe('B on a screen', () => {
  it('draws the screen again, for a back that changes it in place (the results close a card)', () => {
    // Just the fields key() reads: a Stage proper wants a canvas.
    const back = vi.fn();
    const stage = Object.create(Stage.prototype) as Stage;
    Object.assign(stage, { screen: { back }, root: { hidden: false } });
    const paintNow = vi.spyOn(stage, 'paintNow').mockImplementation(() => {});
    expect(stage.key('b')).toBe(true);
    expect(back).toHaveBeenCalledOnce();
    expect(paintNow).toHaveBeenCalledOnce();
  });
});
