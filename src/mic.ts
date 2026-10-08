// The ears: PipeWire's pw-record gives raw PCM from the default microphone; Broca keeps only its loudness, one number
// per 100 ms, in memory. Nothing is recorded, written or sent anywhere.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { CHUNK, RATE, levelOf } from './voice.ts';

const lastLine = (s: string): string => s.trim().split('\n').at(-1)?.trim() ?? '';

export function listenMic(o: { onLevel: (level: number) => void; onError: (reason: string) => void; command?: string; args?: string[] }): { stop(): void } {
  const command = o.command ?? 'pw-record';
  const args = o.args ?? ['--rate', String(RATE), '--channels', '1', '--format', 's16', '-'];
  let stopped = false;
  let reported = false;
  let pending = Buffer.alloc(0);
  let err = '';
  const report = (reason: string): void => { if (stopped || reported) return; reported = true; o.onError(reason); };
  let child: ChildProcess;
  try {
    child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    report(`${command} could not start: ${e instanceof Error ? e.message : String(e)}`);
    return { stop() { stopped = true; } };
  }
  child.on('error', (e) => report(`${command} could not start: ${e.message}`));
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => { err = (err + c).slice(-300); });
  child.stdout!.on('data', (c: Buffer) => {
    pending = Buffer.concat([pending, c]);
    while (pending.length >= CHUNK) { o.onLevel(levelOf(pending.subarray(0, CHUNK))); pending = pending.subarray(CHUNK); }
  });
  child.on('close', (code) => report(`the microphone reader stopped (${command} exited ${code ?? 'killed'}${err === '' ? '' : `: ${lastLine(err)}`})`));
  return { stop() { stopped = true; child.kill('SIGTERM'); } };
}
