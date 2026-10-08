import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHUNK, createEdgeMouth, createLevelPacer, levelOf, playerFor, ttsArgsFor } from '../src/voice.ts';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const never = (): AbortSignal => new AbortController().signal;
// The "voice" in these tests is a shell that prints a real mp3 (half a second of a tone), made once with ffmpeg.
const mp3 = (): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'broca-voice-')), 'tone.mp3');
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-af', 'volume=8', '-ar', '16000', '-ac', '1', file]);
  return file;
};
const mouthWith = (ttsScript: string) => createEdgeMouth({ ttsCommand: 'sh', ttsArgs: ['-c', ttsScript], voice: 'v', player: 'pw-play', playerCommand: 'cat', playerArgs: [] });

test('levelOf is the RMS on a 0..1 scale', () => {
  assert.equal(levelOf(Buffer.alloc(CHUNK)), 0);
  const loud = Buffer.alloc(CHUNK);
  for (let i = 0; i < CHUNK / 2; i++) loud.writeInt16LE(i % 2 ? 32767 : -32767, i * 2);
  assert.ok(Math.abs(levelOf(loud) - 1) < 0.001);
  assert.equal(levelOf(Buffer.alloc(0)), 0);
});

test('ttsArgsFor carries the dash rule: text that starts with a dash is one argument', () => {
  const s = { ttsArgs: ['edge-tts'], voice: 'v' };
  assert.deepEqual(ttsArgsFor(s, 'Hello.'), ['edge-tts', '--voice', 'v', '--text', 'Hello.']);
  assert.deepEqual(ttsArgsFor(s, '-dash first'), ['edge-tts', '--voice', 'v', '--text=-dash first']);
});

test('playerFor is pw-play on raw PCM by default, mpv on request, and anything for tests', () => {
  const base = { ttsCommand: 'uvx', ttsArgs: ['edge-tts'], voice: 'v' };
  assert.deepEqual(playerFor({ ...base, player: 'pw-play' }), { command: 'pw-play', args: ['--raw', '--rate', '16000', '--channels', '1', '--format', 's16', '-'] });
  assert.equal(playerFor({ ...base, player: 'mpv' }).command, 'mpv');
  assert.ok(playerFor({ ...base, player: 'mpv' }).args.includes('--demuxer-rawaudio-rate=16000'));
  assert.deepEqual(playerFor({ ...base, player: 'pw-play', playerCommand: 'cat', playerArgs: ['-'] }), { command: 'cat', args: ['-'] });
});

test('the level pacer releases one level a tick and ends on a zero', async () => {
  const got: number[] = [];
  const pacer = createLevelPacer((l) => got.push(l), 5);
  pacer.push(0.5);
  pacer.push(0.25);
  await wait(60);
  assert.deepEqual(got, [0.5, 0.25, 0]);
  pacer.push(0.75);
  pacer.stop();
  assert.deepEqual(got, [0.5, 0.25, 0, 0]);
});

test('a voice that makes sound: the PCM flows to the player and the levels come out paced', async () => {
  const mouth = mouthWith(`cat ${mp3()}`);
  const levels: number[] = [];
  const started = Date.now();
  const result = await mouth.speak('Hello.', { signal: never(), onLevel: (l) => levels.push(l) });
  assert.equal(result, 'done');
  assert.ok(levels.length >= 4 && levels.length <= 8, `levels: ${levels.length}`);   // 0.5 s = 5 chunks, then the closing zero
  assert.ok(Math.max(...levels) > 0.3, `loudest ${Math.max(...levels)}`);              // a full-scale sine is ~0.7
  assert.equal(levels.at(-1), 0);
  assert.ok(Date.now() - started >= 400, 'levels were paced in real time, not dumped');
});

test('a voice that exits non-zero fails in plain words and does not hang', async () => {
  const result = await mouthWith('echo "Cannot connect to host" >&2; exit 1').speak('Hello.', { signal: never(), onLevel: () => {} });
  assert.deepEqual(result, { failed: 'the voice failed (exit 1: Cannot connect to host)' });
});

test('a voice that makes no audio is a failure too, and an empty line is refused before anything runs', async () => {
  assert.deepEqual(await mouthWith('exit 0').speak('Hello.', { signal: never(), onLevel: () => {} }), { failed: 'the voice sent no audio' });
  assert.deepEqual(await mouthWith('exit 0').speak('   ', { signal: never(), onLevel: () => {} }), { failed: 'there was nothing to say' });
});

test('a voice that sends nothing for too long times out', async () => {
  const mouth = createEdgeMouth({ ttsCommand: 'sh', ttsArgs: ['-c', 'sleep 5'], voice: 'v', player: 'pw-play', playerCommand: 'cat', playerArgs: [], timeoutMs: 100 });
  const started = Date.now();
  assert.deepEqual(await mouth.speak('Hello.', { signal: never(), onLevel: () => {} }), { failed: 'the voice sent nothing for 0.1 s' });
  assert.ok(Date.now() - started < 1500);
});

test('stopping kills the whole chain at once', async () => {
  const controller = new AbortController();
  const promise = mouthWith('sleep 5').speak('Hello.', { signal: controller.signal, onLevel: () => {} });
  await wait(50);
  const started = Date.now();
  controller.abort();
  assert.equal(await promise, 'stopped');
  assert.ok(Date.now() - started < 500);
  assert.equal(await mouthWith('sleep 5').speak('Hello.', { signal: AbortSignal.abort(), onLevel: () => {} }), 'stopped');
});

test('a player that is not installed is a failure in plain words', async () => {
  const mouth = createEdgeMouth({ ttsCommand: 'sh', ttsArgs: ['-c', 'sleep 5'], voice: 'v', player: 'pw-play', playerCommand: '/nonexistent/player', playerArgs: [] });
  const result = await mouth.speak('Hello.', { signal: never(), onLevel: () => {} });
  assert.ok(typeof result === 'object' && /\/nonexistent\/player could not start/.test(result.failed), JSON.stringify(result));
});
