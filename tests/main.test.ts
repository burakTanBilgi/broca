import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/main.ts';

test('a bare argument is a session id', () => {
  const a = parseArgs(['11111111-2222-3333-4444-555555555555']);
  assert.equal(a.sessionId, '11111111-2222-3333-4444-555555555555');
  assert.equal(a.help, false);
});

test('--cwd takes a folder', () => {
  assert.equal(parseArgs(['--cwd', 'x']).cwd, 'x');
});

test('--say takes the text, and needs no chat', () => {
  assert.equal(parseArgs(['--say', 'hi']).say, 'hi');
});

test('an unknown option throws with the usage', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope[\s\S]*broca <session-id>/);
});

test('no arguments throws the usage', () => {
  assert.throws(() => parseArgs([]), /broca <session-id>/);
});

test('an option missing its value throws', () => {
  assert.throws(() => parseArgs(['--cwd']), /--cwd needs a value/);
});
