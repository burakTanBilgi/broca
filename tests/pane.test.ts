import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bar, floorOf, render, wave, wrapWords } from '../src/pane.ts';
import type { PaneState } from '../src/pane.ts';

const width = (row: string): number => [...row].length;
const state = (over: Partial<PaneState> = {}): PaneState =>
  ({ name: 'Secretary', state: 'speaking', you: [], me: [0, 0.2, 0.4], line: 'The build is green and the page is ready for you.', note: null, muted: false, width: 60, ...over });

test('bar maps a 0..1 norm onto the eight blocks', () => {
  assert.equal(bar(0), '▁');
  assert.equal(bar(0.125), '▂');
  assert.equal(bar(0.5), '▅');
  assert.equal(bar(0.99), '█');
  assert.equal(bar(1), '█');
  assert.equal(bar(5), '█');
  assert.equal(bar(-1), '▁');
});

test('floorOf is the quietest recent level, never below a thousandth', () => {
  assert.equal(floorOf([]), 0.001);
  assert.equal(floorOf([0.5, 0.02, 0.3]), 0.02);
  assert.equal(floorOf([0.5, 0]), 0.5);
  assert.equal(floorOf([0, 0]), 0.001);
  assert.equal(floorOf([0, 0, 0.02, 0.03]), 0.02);               // zeros are the gate, not the room
  assert.equal(floorOf([0.9, ...new Array(50).fill(0.1)]), 0.1);   // only the last 50 count
});

test('wave scales to the room: flat when nothing rises above the noise, full at the loudest recent level', () => {
  assert.equal(wave([], 4), '▁▁▁▁');
  assert.equal(wave([0.1, 0.1, 0.1], 3), '▁▁▁');                   // steady noise at any gain is flat
  assert.equal(wave([0.1, 0.11, 0.1], 3), '▁▁▁');                  // less than twice the floor is still noise
  assert.equal(wave([0.01, 0.01, 0.02, 0.04], 4), '▁▁▃█');         // a quiet microphone still shows the voice
  assert.equal(wave([0.2, 0.2, 0.4, 0.8], 4), '▁▁▃█');             // the same shape at a hot gain
  assert.equal(wave([0, 0.5, 1], 3), '▁▁█');                       // the me wave: silence is exactly 0 and does not set the floor
  assert.equal(wave([0, 0.01, 1], 4), '▁▁▁█');                           // padding on the left
  assert.equal(wave([0.02, 0, 0, 0.02, 0.03, 0.06], 6), '▁▁▁▁▃█');
  assert.equal(wave([1], 0), '');
});

test('wrapWords wraps on words, cuts long words, and ends a cut text with an ellipsis', () => {
  assert.deepEqual(wrapWords('The build is green.', 30, 3), ['The build is green.']);
  assert.deepEqual(wrapWords('one two three four', 9, 3), ['one two', 'three', 'four']);
  assert.deepEqual(wrapWords('one two three four five six', 9, 2), ['one two', 'three fo…']);
  assert.deepEqual(wrapWords('abcdefghijkl', 5, 3), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapWords('', 5, 3), []);
});

test('every row of the pane is the same width, with the frame and the words in place', () => {
  const rows = render(state(), false);
  assert.equal(rows.length, 10);
  for (const r of rows) assert.equal(width(r), width(rows[0]!), r);
  assert.equal(width(rows[0]!), 60);
  assert.match(rows[0]!, /^ ┌ broca · Secretary ─+ speaking ┐$/);
  assert.match(rows[1]!, /^ │ you   ▁+ +│$/);
  assert.match(rows[2]!, /^ │ me    ▁+█ +│$/);
  assert.match(rows[3]!, /^ │ +│$/);
  assert.match(rows[4]!, /^ │ "The build is green and the page is ready for you\." +│$/);
  assert.match(rows[8]!, /^ │ space: stop · m: mute · q: quit +│$/);
  assert.match(rows[9]!, /^ └─+┘$/);
});

test('a long sentence wraps into three rows at most, the last cut with an ellipsis; a note sits below', () => {
  const long = 'The build is green and the page is ready for you, the tests passed twice, the plan is written, nothing is waiting on anyone, the logs are clean, the branch is merged, the notes are filed, and the next step is yours.';
  const rows = render(state({ line: long, note: 'the voice could not be reached' }), false);
  for (const r of rows) assert.equal(width(r), 60, r);
  assert.match(rows[4]!, /^ │ "The build is green and /);
  assert.match(rows[6]!, /…" +│$/);
  assert.match(rows[7]!, /^ │ the voice could not be reached +│$/);
  const none = render(state({ line: null }), false);
  for (const i of [4, 5, 6, 7]) assert.match(none[i]!, /^ │ +│$/);
});

test('muted shows in the title and the keys row; listening and quiet are state words', () => {
  const rows = render(state({ muted: true, state: 'quiet' }), false);
  assert.match(rows[0]!, / quiet · muted ┐$/);
  assert.match(rows[8]!, /m: unmute/);
  assert.match(render(state({ state: 'listening' }), false)[0]!, / listening ┐$/);
});

test('a narrow terminal still gets a whole frame, a wide one is capped', () => {
  const narrow = render(state({ width: 30, name: 'A very long chat name indeed' }), false);
  for (const r of narrow) assert.equal(width(r), 30, r);
  assert.match(narrow[0]!, /…/);
  const wide = render(state({ width: 200 }), false);
  for (const r of wide) assert.equal(width(r), 81, r);
});

test('colour adds escape codes but not width', () => {
  const plain = render(state(), false);
  const colour = render(state(), true);
  assert.notEqual(plain[1], colour[1]);
  assert.equal(width(colour[1]!.replace(/\x1b\[[0-9;]*m/g, '')), width(plain[1]!));
});

test('render turns control characters in the name, line and note into spaces', () => {
  const rows = render(state({ name: 'x\u001b[31my', line: 'a\u001bb', note: 'n\u0007' }), false);
  for (const r of rows) assert.ok(!r.includes('\u001b') && !r.includes('\u0007'));
  assert.equal(new Set(rows.map(width)).size, 1);
});
