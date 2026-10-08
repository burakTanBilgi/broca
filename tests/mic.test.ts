import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listenMic } from '../src/mic.ts';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('the microphone reader turns PCM into one level every 100 ms of audio', async () => {
  const levels: number[] = [];
  const errors: string[] = [];
  // 6400 bytes of zeros = two chunks of silence, then 1 byte left over (never reported), then the reader ends
  const mic = listenMic({ onLevel: (l) => levels.push(l), onError: (e) => errors.push(e), command: 'sh', args: ['-c', 'head -c 6401 /dev/zero'] });
  await wait(200);
  mic.stop();
  assert.deepEqual(levels, [0, 0]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /microphone reader stopped/);
});

test('a reader that cannot start says so once', async () => {
  const errors: string[] = [];
  const mic = listenMic({ onLevel: () => {}, onError: (e) => errors.push(e), command: '/nonexistent/pw-record' });
  await wait(100);
  mic.stop();
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.match(errors[0]!, /could not start/);
});

test('stopping the reader is quiet', async () => {
  const errors: string[] = [];
  const mic = listenMic({ onLevel: () => {}, onError: (e) => errors.push(e), command: 'sleep', args: ['5'] });
  await wait(30);
  mic.stop();
  await wait(50);
  assert.deepEqual(errors, []);
});
