import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatName, findTranscript, followTranscript, openChat, parseLines, projectSlug } from '../src/transcript.ts';

const ID = '4f1c9b2e-7d3a-4e8b-9c1d-2a6f8e0b5c37';
const ID2 = '8e2d6a1f-3b4c-4d5e-8f90-1a2b3c4d5e6f';
const rec = (o: object): string => JSON.stringify(o) + '\n';
const projects = (): string => mkdtempSync(join(tmpdir(), 'broca-test-'));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('projectSlug turns a working directory into Claude Code\'s folder name', () => {
  assert.equal(projectSlug('/home/you/Desktop/notes'), '-home-you-Desktop-notes');
  assert.equal(projectSlug('/home/you/Desktop/notes.map_v2'), '-home-you-Desktop-notes-map-v2');
});

test('parseLines keeps the half-written last line for next time and skips lines that are not JSON', () => {
  const r = parseLines('{"a":1}\nnot json\n{"b":2}\n{"c":');
  assert.deepEqual(r.records, [{ a: 1 }, { b: 2 }]);
  assert.equal(r.rest, '{"c":');
  assert.deepEqual(parseLines('{"a":1}\n'), { records: [{ a: 1 }], rest: '' });
  assert.deepEqual(parseLines(''), { records: [], rest: '' });
});

test('findTranscript by session id looks in every project folder', () => {
  const p = projects();
  mkdirSync(join(p, '-home-x'));
  mkdirSync(join(p, '-home-y'));
  writeFileSync(join(p, '-home-y', `${ID}.jsonl`), '');
  assert.equal(findTranscript({ sessionId: ID, projectsDir: p }), join(p, '-home-y', `${ID}.jsonl`));
  assert.throws(() => findTranscript({ sessionId: ID2, projectsDir: p }), /no chat 8e2d6a1f/);
});

test('findTranscript by cwd takes the newest chat and ignores subagent folders and other files', () => {
  const p = projects();
  const d = join(p, '-home-you-Desktop-notes');
  mkdirSync(d);
  mkdirSync(join(d, ID2));                       // a session's subagent folder
  mkdirSync(join(d, 'memory'));
  writeFileSync(join(d, `${ID}.jsonl`), '');
  writeFileSync(join(d, `${ID2}.jsonl`), '');
  writeFileSync(join(d, 'notes.jsonl'), '');
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(d, `${ID2}.jsonl`), old, old);
  assert.equal(findTranscript({ cwd: '/home/you/Desktop/notes', projectsDir: p }), join(d, `${ID}.jsonl`));
  assert.throws(() => findTranscript({ cwd: '/nowhere', projectsDir: p }), /no chat for \/nowhere/);
  assert.throws(() => findTranscript({ projectsDir: p }), /session id or --cwd/);
});

test('chatName prefers the agent name, then the custom title, then the AI title, the latest of each', () => {
  assert.equal(chatName([
    { type: 'ai-title', aiTitle: 'Notes work' }, { type: 'custom-title', customTitle: 'GS' },
    { type: 'agent-name', agentName: 'Old' }, { type: 'agent-name', agentName: 'Secretary' },
  ]), 'Secretary');
  assert.equal(chatName([{ type: 'ai-title', aiTitle: 'Notes work' }, { type: 'custom-title', customTitle: 'GS' }]), 'GS');
  assert.equal(chatName([{ type: 'ai-title', aiTitle: 'Notes work' }]), 'Notes work');
  assert.equal(chatName([{ type: 'user' }, 5, null]), null);
});

test('openChat reads the name once and reports the offset after the last whole line', () => {
  const p = projects();
  const d = join(p, '-home-x');
  mkdirSync(d);
  const f = join(d, `${ID}.jsonl`);
  const whole = rec({ type: 'agent-name', agentName: 'Secretary' }) + rec({ type: 'assistant' });
  writeFileSync(f, whole + '{"type":"assis');
  const chat = openChat({ sessionId: ID, projectsDir: p });
  assert.equal(chat.file, f);
  assert.equal(chat.sessionId, ID);
  assert.equal(chat.name, 'Secretary');
  assert.equal(chat.size, Buffer.byteLength(whole));
  writeFileSync(f, '');
  assert.equal(openChat({ sessionId: ID, projectsDir: p }).name, '4f1c9b2e');
});

test('followTranscript emits only whole records appended after its offset, and starts over if the file shrinks', async () => {
  const p = projects();
  const f = join(p, 'chat.jsonl');
  writeFileSync(f, rec({ old: true }));
  const got: unknown[] = [];
  const follower = followTranscript(f, (r) => got.push(r), { fromOffset: Buffer.byteLength(rec({ old: true })), intervalMs: 20 });
  try {
    appendFileSync(f, rec({ n: 1 }) + '{"n":');
    await wait(120);
    assert.deepEqual(got, [{ n: 1 }]);
    appendFileSync(f, '2}\n');
    await wait(120);
    assert.deepEqual(got, [{ n: 1 }, { n: 2 }]);
    assert.equal(follower.offset, Buffer.byteLength(rec({ old: true }) + rec({ n: 1 }) + rec({ n: 2 })));
    writeFileSync(f, rec({ fresh: true }));
    await wait(120);
    assert.deepEqual(got.at(-1), { fresh: true });
  } finally {
    follower.stop();
  }
});
