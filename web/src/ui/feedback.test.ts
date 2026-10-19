// FEEDBACK (POK-428): the box, the line under it, and SEND only when there is a note.
import { describe, expect, it, vi } from 'vitest';
import { FEEDBACK_MAX } from '../net/feedback';
import { BOX_ROWS, FEEDBACK_TEXT_ID, boxRows, feedbackLine, feedbackScreen, type FeedbackModel } from './feedback';
import { TEXT_BLUE, TEXT_RED } from './emerald';
import { fakeCanvas } from './fakecanvas';

function model(over: Partial<FeedbackModel> = {}): FeedbackModel {
  return { text: '', state: 'typing', onInput: vi.fn(), onSend: vi.fn(), onBack: vi.fn(), ...over };
}

function paint(m: FeedbackModel) {
  const fake = fakeCanvas();
  const painted = feedbackScreen(() => m).paint(fake.canvas, 320);
  const byId = (id: string) => painted.widgets.find((w) => w.id === id)!;
  return { ...fake, painted, byId };
}

describe('the FEEDBACK screen', () => {
  it('starts with the prompt in the box and SEND not pressable', () => {
    const { texts, byId } = paint(model());
    expect(texts.map((t) => t.text)).toContain('Tap here to type.');
    expect(byId('feedback-send').disabled).toBe(true);
    expect(byId('feedback-back').disabled).toBeFalsy();
    expect(byId('feedback-note').text).toBe(`0/${FEEDBACK_MAX}`);
  });

  it('makes the box a field holding the draft, whose typing reaches the model', () => {
    const onInput = vi.fn();
    const { byId } = paint(model({ text: 'the ferry', onInput }));
    const box = byId(FEEDBACK_TEXT_ID);
    expect(box.field?.value).toBe('the ferry');
    expect(box.field?.max).toBe(FEEDBACK_MAX);
    box.field?.onInput('the ferry broke');
    expect(onInput).toHaveBeenCalledWith('the ferry broke');
    expect(byId('feedback-send').disabled).toBe(false);
  });

  it('draws what was typed in the box, and only its last rows when it runs long', () => {
    const { texts } = paint(model({ text: 'softlock on the ferry' }));
    expect(texts.map((t) => t.text)).toContain('softlock on the ferry');
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const { rows, prompt } = boxRows(long, 216);
    expect(prompt).toBe(false);
    expect(rows).toHaveLength(BOX_ROWS);
    expect(rows[rows.length - 1].endsWith('word39')).toBe(true);
  });

  it('holds SEND and the box while a note is on its way', () => {
    const { byId } = paint(model({ text: 'hi', state: 'sending' }));
    expect(byId('feedback-send').disabled).toBe(true);
    expect(byId(FEEDBACK_TEXT_ID).field?.readOnly, 'held, not disabled: the keyboard stays up').toBe(true);
    expect(byId('feedback-note').text).toBe('Sending…');
  });

  it('says how a send ended', () => {
    expect(feedbackLine('', 'sent')).toEqual({ text: 'Sent. Thank you!', color: TEXT_BLUE });
    expect(feedbackLine('x', 'failed')).toEqual({ text: "Couldn't reach the server. Try again.", color: TEXT_RED });
    expect(feedbackLine('x', 'busy').color).toBe(TEXT_RED);
    expect(feedbackLine('x', 'full').text).toBe('Lots of notes right now. Try later.');
    // the box's own count (UTF-16, as maxLength stops it), not the cleaned note's
    expect(feedbackLine(' two  words ', 'typing').text).toBe(`12/${FEEDBACK_MAX}`);
    expect(feedbackLine('😀', 'typing').text).toBe(`2/${FEEDBACK_MAX}`);
  });

  it('SEND, BACK and B do what the model says', () => {
    const m = model({ text: 'hi' });
    const screen = feedbackScreen(() => m);
    const { byId } = paint(m);
    byId('feedback-send').onPress?.();
    byId('feedback-back').onPress?.();
    screen.back?.();
    expect(m.onSend).toHaveBeenCalledTimes(1);
    expect(m.onBack).toHaveBeenCalledTimes(2);
  });

  it('takes the look it is given, dimming the game under it as the sheet does', () => {
    expect(feedbackScreen(() => model()).look?.()).toBe('full');
    expect(feedbackScreen(() => model({ look: 'dock' })).look?.()).toBe('dock');
    const over = paint(model({ look: 'overlay' }));
    expect(over.fills[0]).toMatchObject({ color: '#000', alpha: 0.6 });
    expect(paint(model()).fills.filter((f) => f.color === '#000')).toEqual([]);
  });

  it('fits a phone held upright with the keyboard up: SEND inside 240 rows', () => {
    const { byId } = paint(model({ text: 'hi' }));
    const send = byId('feedback-send').rect;
    expect(send.y + send.h).toBeLessThanOrEqual(240);
  });
});
