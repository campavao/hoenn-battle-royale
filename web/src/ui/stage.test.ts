import { describe, expect, it } from 'vitest';
import { Mirror, type Painted, type Widget } from './stage';

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
  style: Record<string, string> = {};
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  readonly ownerDocument = fakeDocument;
  private listeners: ((ev: { target: FakeNode }) => void)[] = [];

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  addEventListener(_type: 'click', fn: (ev: { target: FakeNode }) => void): void {
    this.listeners.push(fn);
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
    for (let n: FakeNode | null = this; n; n = n.parentNode) for (const fn of n.listeners) fn({ target: this });
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

function mirror() {
  const hits = new FakeNode('div');
  const m = new Mirror(hits as unknown as HTMLElement, (w) => w.onPress?.());
  const sync = (p: Painted) => m.sync(p, 2, 0);
  const byId = (id: string) => hits.all().find((n) => n.id === id)!;
  const byText = (text: string) => hits.all().filter((n) => n.textContent === text);
  return { hits, m, sync, byId, byText };
}

const at = (y: number) => ({ x: 8, y, w: 64, h: 16 });

describe('the drawn screen\'s DOM copy (POK-330 #33)', () => {
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
