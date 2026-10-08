import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineFinder, scrub, spokenLines, spokenLinesInText } from '../src/lines.ts';

const text = (t: string): object => ({ type: 'text', text: t });

test('a line is spoken when it starts with » and a space, and nothing else is', () => {
  assert.deepEqual(spokenLinesInText('» The build is green.\n\nThe rest stays on screen.\n» Second news.'), ['The build is green.', 'Second news.']);
  assert.deepEqual(spokenLinesInText(' » indented\n»no space\n- » in a list\nmid » line\n»  '), []);
  assert.deepEqual(spokenLinesInText('» Spaces around are trimmed.   '), ['Spaces around are trimmed.']);
  assert.deepEqual(spokenLinesInText(''), []);
});

test('lines inside a code fence are not spoken', () => {
  assert.deepEqual(spokenLinesInText('The rule:\n```\n» example\n```\n» Real.'), ['Real.']);
  assert.deepEqual(spokenLinesInText('~~~text\n» quoted\n~~~'), []);
  assert.deepEqual(spokenLinesInText('  ```md\n» quoted\n  ```\n» After.'), ['After.']);
});

test('only assistant text blocks of the main chat count', () => {
  assert.deepEqual(spokenLines({ type: 'assistant', uuid: '1', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: '» echo' } }, text('» Hello.')] } }), ['Hello.']);
  assert.deepEqual(spokenLines({ type: 'assistant', message: { content: [text('» One.'), text('» Two.')] } }), ['One.', 'Two.']);
  assert.deepEqual(spokenLines({ type: 'user', message: { content: '» Not me.' } }), []);
  assert.deepEqual(spokenLines({ type: 'assistant', isSidechain: true, message: { content: [text('» Subagent.')] } }), []);
  assert.deepEqual(spokenLines({ type: 'assistant', message: { content: '» string content' } }), []);
  assert.deepEqual(spokenLines({ type: 'agent-name', agentName: '» x' }), []);
  assert.deepEqual(spokenLines(null), []);
  assert.deepEqual(spokenLines('» x'), []);
});

test('the finder speaks a record once even if the file shows it twice', () => {
  const finder = createLineFinder();
  const r = { type: 'assistant', uuid: 'u1', message: { content: [text('» Once.')] } };
  assert.deepEqual(finder.next(r), ['Once.']);
  assert.deepEqual(finder.next(r), []);
  assert.deepEqual(finder.next({ ...r, uuid: 'u2' }), ['Once.']);
  assert.deepEqual(finder.next({ type: 'assistant', message: { content: [text('» No uuid.')] } }), ['No uuid.']);
});

test('control characters in a spoken line are turned into spaces', () => {
  assert.deepEqual(spokenLinesInText('» Evil\u001b[2J line\u0007 here'), ['Evil [2J line here']);
  assert.equal(scrub('a\u0000b  c\u009fd'), 'a b c d');
});

test('a code fence closes only with its own kind', () => {
  assert.deepEqual(spokenLinesInText('```\n~~~\n» inside\n```\n» after'), ['after']);
  assert.deepEqual(spokenLinesInText('~~~\n```\n» inside\n~~~\n» after'), ['after']);
});
