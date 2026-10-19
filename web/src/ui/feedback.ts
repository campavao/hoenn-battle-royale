// FEEDBACK (POK-428): a box to say what went wrong or what would be better, sent to the
// relay and from there to Linear. The one drawn screen with free text in it, so the box
// is a real <textarea> in the mirror (stage.ts `field`): a phone's own keyboard types
// into it, and this draws what it holds in Emerald's font.
import { FEEDBACK_MAX, cleanNote, type FeedbackResult } from '../net/feedback';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_RED, type TextColor, fitText, wrapText } from './emerald';
import { ROW_H, W, paintButtons, paintTitle } from './screens';
import type { DrawnScreen, Look, Painted, Widget } from './stage';

/** Where a send is: not yet, on its way, or how it ended. */
export type FeedbackState = 'typing' | 'sending' | FeedbackResult;

export interface FeedbackModel {
  /** Over the game or beside it in a match, as the sheet it came from is, so the game
   *  stays in view while somebody types; the menu's own screen otherwise. */
  look?: Look;
  text: string;
  state: FeedbackState;
  onInput(text: string): void;
  onSend(): void;
  onBack(): void;
}

/** The lines the box shows. Six fit above a phone's keyboard; past that the newest. */
export const BOX_ROWS = 6;

/** What the line under the box says, and in what colour. */
export function feedbackLine(text: string, state: FeedbackState): { text: string; color: TextColor } {
  switch (state) {
    case 'sending':
      return { text: 'Sending…', color: TEXT_GRAY };
    case 'sent':
      return { text: 'Sent. Thank you!', color: TEXT_BLUE };
    case 'busy':
      return { text: 'That is a lot of notes. Try later.', color: TEXT_RED };
    case 'full':
      return { text: 'Lots of notes right now. Try later.', color: TEXT_RED };
    case 'failed':
      return { text: "Couldn't reach the server. Try again.", color: TEXT_RED };
    default:
      // The box's own count, which is where it stops taking letters.
      return { text: `${text.length}/${FEEDBACK_MAX}`, color: TEXT_GRAY };
  }
}

/** The box's rows: the end of what was typed, wrapped, or the prompt when nothing was. */
export function boxRows(text: string, width: number): { rows: string[]; prompt: boolean } {
  // A typed line break starts a new row; a blank line stays blank.
  const rows = text.trim() ? text.split('\n').flatMap((para) => (para.trim() ? wrapText(para, width) : [''])) : [];
  if (rows.length === 0) return { rows: ['Tap here to type.'], prompt: true };
  return { rows: rows.slice(-BOX_ROWS), prompt: false };
}

export const FEEDBACK_TEXT_ID = 'feedback-text';

export function feedbackScreen(model: () => FeedbackModel): DrawnScreen {
  return {
    look: () => model().look ?? 'full',
    back() {
      model().onBack();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      // Over the game, the game dimmed, as the sheet does: it is still running under this.
      if (m.look === 'overlay') c.fillRect({ x: -c.origin, y: 0, w: c.width, h }, '#000', 0.6);
      let y = 4;
      paintTitle(c, 'FEEDBACK', y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: 'FEEDBACK', id: 'feedback-title', cursor: null });
      y += 20;
      const intro = 'A bug or an idea? Tell us here.';
      const introRows = wrapText(intro, W - 8);
      introRows.forEach((row, i) => c.drawTextCentred(row, W / 2, y + i * ROW_H, TEXT_GRAY));
      widgets.push({ rect: { x: 0, y, w: W, h: introRows.length * ROW_H }, text: intro, cursor: null });
      y += introRows.length * ROW_H + 4;

      const frame = { x: 0, y, w: W, h: BOX_ROWS * ROW_H + 16 };
      c.drawFrame(frame);
      const { rows, prompt } = boxRows(m.text, W - 28);
      rows.forEach((row, i) => c.drawText(row, 15, y + 8 + i * ROW_H, prompt ? TEXT_GRAY : TEXT_DARK));
      const sending = m.state === 'sending';
      widgets.push({
        rect: { x: 8, y: y + 4, w: W - 16, h: frame.h - 8 },
        text: 'Your feedback',
        id: FEEDBACK_TEXT_ID,
        field: { value: m.text, max: FEEDBACK_MAX, readOnly: sending, onInput: m.onInput },
        // A pad or the keyboard's A puts the caret in it, as a tap does.
        onPress: () => globalThis.document?.getElementById(FEEDBACK_TEXT_ID)?.focus(),
        cursor: { x: 7, y: y + 8 },
      });
      y += frame.h + 2;

      const line = feedbackLine(m.text, m.state);
      c.drawTextCentred(fitText(line.text, W - 8), W / 2, y, line.color);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: line.text, id: 'feedback-note', cursor: null });
      y += ROW_H + 4;

      widgets.push(
        ...paintButtons(c, y, [
          { label: 'SEND', id: 'feedback-send', disabled: sending || cleanNote(m.text) === '', onPress: m.onSend },
          { label: 'BACK', id: 'feedback-back', onPress: m.onBack },
        ]),
      );
      return { widgets };
    },
  };
}
