// The FEEDBACK screen and its send, in a chunk of their own (main.js's budget, after
// HBR-30): a note is written now and then, and the page needn't carry it at boot.
export { feedbackScreen } from './feedback';
export { cleanNote, sendFeedback } from '../net/feedback';
