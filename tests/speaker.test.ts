import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker } from '../src/speaker.ts';
import type { Mouth, SpeakResult } from '../src/voice.ts';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A mouth that takes `ms` a line, logs what it does, and honours its stop signal.
function fakeMouth(log: string[], ms = 20, result: SpeakResult = 'done'): Mouth {
  return {
    speak: (text, o) => new Promise((resolve) => {
      log.push(`start ${text}`);
      const timer = setTimeout(() => { log.push(`end ${text}`); resolve(result); }, ms);
      o.signal.addEventListener('abort', () => { clearTimeout(timer); log.push(`abort ${text}`); resolve('stopped'); }, { once: true });
    }),
  };
}
function harness(mouth: Mouth) {
  const ends: [string, SpeakResult][] = [];
  const starts: string[] = [];
  const speaker = createSpeaker(mouth, { onStart: (t) => starts.push(t), onEnd: (t, r) => ends.push([t, r]), onLevel: () => {} });
  return { speaker, starts, ends };
}

test('lines are spoken one at a time, in order', async () => {
  const log: string[] = [];
  const { speaker, starts, ends } = harness(fakeMouth(log));
  speaker.say('a');
  speaker.say('b');
  assert.equal(speaker.speaking, true);
  await wait(100);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b']);
  assert.deepEqual(starts, ['a', 'b']);
  assert.deepEqual(ends, [['a', 'done'], ['b', 'done']]);
  assert.equal(speaker.speaking, false);
});

test('stop drops the queue and cuts the line being said', async () => {
  const log: string[] = [];
  const { speaker, ends } = harness(fakeMouth(log));
  speaker.say('a');
  speaker.say('b');
  speaker.say('c');
  await wait(5);
  speaker.stop();
  await wait(60);
  assert.deepEqual(log, ['start a', 'abort a']);
  assert.deepEqual(ends, [['a', 'stopped']]);
  speaker.say('d');
  await wait(60);
  assert.deepEqual(log.at(-1), 'end d');
});

test('muted lines are shown and finished without the mouth; unmuting speaks again', async () => {
  const log: string[] = [];
  const { speaker, starts, ends } = harness(fakeMouth(log));
  speaker.setMuted(true);
  assert.equal(speaker.muted, true);
  speaker.say('a');
  await wait(30);
  assert.deepEqual(log, []);
  assert.deepEqual(starts, ['a']);
  assert.deepEqual(ends, [['a', 'done']]);
  speaker.setMuted(false);
  speaker.say('b');
  await wait(60);
  assert.deepEqual(log, ['start b', 'end b']);
});

test('muting mid-line cuts it', async () => {
  const log: string[] = [];
  const { speaker, ends } = harness(fakeMouth(log, 50));
  speaker.say('a');
  await wait(5);
  speaker.setMuted(true);
  await wait(20);
  assert.deepEqual(log, ['start a', 'abort a']);
  assert.deepEqual(ends, [['a', 'stopped']]);
});

test('a failing mouth reports in plain words and the next line still goes', async () => {
  const log: string[] = [];
  const { speaker, ends } = harness(fakeMouth(log, 5, { failed: 'the voice failed (exit 1)' }));
  speaker.say('a');
  speaker.say('b');
  await wait(60);
  assert.deepEqual(ends, [['a', { failed: 'the voice failed (exit 1)' }], ['b', { failed: 'the voice failed (exit 1)' }]]);
});

test('a mouth that throws is treated as a failure, not a crash', async () => {
  const mouth: Mouth = { speak: async () => { throw new Error('boom'); } };
  const { speaker, ends } = harness(mouth);
  speaker.say('a');
  await wait(20);
  assert.deepEqual(ends, [['a', { failed: 'boom' }]]);
});
