// The mouth: text in, sound out. Microsoft's online voice through `uvx edge-tts` — the way an earlier project of the author
// calls it, the few lines carried over are named in CREDITS.md — decoded by ffmpeg to plain PCM so Broca can read the loudness on its way to
// the player, and stopped by killing the whole chain. Only the text leaves the machine.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export const RATE = 16000;                  // samples a second
export const CHUNK = (RATE / 10) * 2;       // 100 ms of 16-bit mono: 3200 bytes
const PCM_ARGS = ['-f', 's16le', '-ar', String(RATE), '-ac', '1'];
const STDERR_TAIL = 300;

export interface VoiceSettings {
  ttsCommand: string; ttsArgs: string[]; voice: string; player: 'pw-play' | 'mpv';
  decoder?: string;                         // ffmpeg, or a stand-in
  playerCommand?: string; playerArgs?: string[];   // override the player, for tests
  timeoutMs?: number;                       // how long to wait for the voice's first byte
}
export type SpeakResult = 'done' | 'stopped' | { failed: string };
export interface Mouth { speak(text: string, o: { signal: AbortSignal; onLevel: (level: number) => void }): Promise<SpeakResult> }

// RMS of signed 16-bit little-endian samples, on a 0..1 scale.
export function levelOf(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const s = pcm.readInt16LE(i * 2); sum += s * s; }
  return Math.sqrt(sum / n) / 32768;
}

// Carried over from an earlier project of the author (see CREDITS.md): text that starts with a dash must not look like a flag to the program.
export function ttsArgsFor(s: { ttsArgs: string[]; voice: string }, text: string): string[] {
  return [...s.ttsArgs, '--voice', s.voice, ...(text.startsWith('-') ? [`--text=${text}`] : ['--text', text])];
}

export function playerFor(s: VoiceSettings): { command: string; args: string[] } {
  if (s.playerCommand !== undefined) return { command: s.playerCommand, args: s.playerArgs ?? [] };
  if (s.player === 'mpv') {
    return { command: 'mpv', args: ['--no-video', '--really-quiet', '--no-config', '--demuxer=rawaudio', '--demuxer-rawaudio-format=s16le', `--demuxer-rawaudio-rate=${RATE}`, '--demuxer-rawaudio-channels=1', '-'] };
  }
  return { command: 'pw-play', args: ['--raw', '--rate', String(RATE), '--channels', '1', '--format', 's16', '-'] };
}

// ffmpeg decodes faster than the player plays, so the levels are queued and let out one per 100 ms from the first
// chunk on; when the queue runs dry a zero is sent and the clock stops until more arrives.
export function createLevelPacer(onLevel: (level: number) => void, intervalMs = 100): { push(level: number): void; stop(): void; idle(): Promise<void> } {
  const queue: number[] = [];
  let timer: NodeJS.Timeout | null = null;
  let waiters: Array<() => void> = [];
  const release = (): void => { const w = waiters; waiters = []; for (const f of w) f(); };
  const halt = (): void => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const tick = (): void => {
    const level = queue.shift();
    if (level === undefined) { halt(); onLevel(0); release(); } else onLevel(level);
  };
  return {
    push(level) { queue.push(level); if (timer === null) timer = setInterval(tick, intervalMs); },
    stop() { queue.length = 0; halt(); onLevel(0); release(); },
    // resolves once every queued level has been let out (the player can finish before the pacer does)
    idle() { return timer === null ? Promise.resolve() : new Promise<void>((r) => { waiters.push(r); }); },
  };
}

// Carried over from an earlier project of the author (see CREDITS.md): a launcher (`uvx`) may run the real program as its own child, so each program runs in a process group of
// its own and the whole group is killed. A child that has already exited is left alone.
function killGroup(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid !== undefined) { process.kill(-child.pid, 'SIGKILL'); return; }
  } catch { /* no such group: fall through */ }
  child.kill('SIGKILL');
}

const lastLine = (s: string): string => s.trim().split('\n').at(-1)?.trim() ?? '';

export function createEdgeMouth(s: VoiceSettings): Mouth {
  const decoder = s.decoder ?? 'ffmpeg';
  const timeoutMs = s.timeoutMs ?? 15_000;
  return {
    speak(text, o) {
      return new Promise<SpeakResult>((resolve) => {
        const said = text.trim();
        if (said === '') return resolve({ failed: 'there was nothing to say' });
        if (o.signal.aborted) return resolve('stopped');
        const player = playerFor(s);
        const procs: ChildProcess[] = [];
        const pacer = createLevelPacer(o.onLevel);
        let settled = false;
        let bytes = 0;
        let ttsErr = '';
        let pending = Buffer.alloc(0);
        let firstByteTimer: NodeJS.Timeout | null = null;
        const finish = (result: SpeakResult): void => {
          if (settled) return;
          settled = true;
          if (firstByteTimer !== null) clearTimeout(firstByteTimer);
          o.signal.removeEventListener('abort', onAbort);
          pacer.stop();
          for (const p of procs) killGroup(p);
          resolve(result);
        };
        const onAbort = (): void => finish('stopped');
        o.signal.addEventListener('abort', onAbort, { once: true });
        const start = (command: string, args: string[], stdin: 'pipe' | 'ignore', stdout: 'pipe' | 'ignore'): ChildProcess | null => {
          try {
            const p = spawn(command, args, { stdio: [stdin, stdout, 'pipe'], detached: true });
            procs.push(p);
            p.on('error', (e) => finish({ failed: `${command} could not start: ${e.message}` }));
            p.stdin?.on('error', () => { /* the next program is gone: the chain is ending anyway */ });
            return p;
          } catch (e) {
            finish({ failed: `${command} could not start: ${e instanceof Error ? e.message : String(e)}` });
            return null;
          }
        };
        const tts = start(s.ttsCommand, ttsArgsFor(s, said), 'ignore', 'pipe');
        if (tts === null) return;
        const dec = start(decoder, ['-nostdin', '-loglevel', 'error', '-i', 'pipe:0', ...PCM_ARGS, 'pipe:1'], 'pipe', 'pipe');
        if (dec === null) return;
        const play = start(player.command, player.args, 'pipe', 'ignore');
        if (play === null) return;

        firstByteTimer = setTimeout(() => finish({ failed: `the voice sent nothing for ${timeoutMs / 1000} s` }), timeoutMs);
        tts.stderr!.setEncoding('utf8');
        tts.stderr!.on('data', (c: string) => { ttsErr = (ttsErr + c).slice(-STDERR_TAIL); });
        tts.stdout!.on('data', (c: Buffer) => {
          bytes += c.length;
          if (firstByteTimer !== null) { clearTimeout(firstByteTimer); firstByteTimer = null; }
          dec.stdin!.write(c);
        });
        tts.stdout!.on('end', () => dec.stdin!.end());
        tts.on('close', (code) => {
          if (code !== 0) finish({ failed: `the voice failed (exit ${code ?? 'killed'}${ttsErr === '' ? '' : `: ${lastLine(ttsErr)}`})` });
          else if (bytes === 0) finish({ failed: 'the voice sent no audio' });
        });
        dec.stdout!.on('data', (c: Buffer) => {
          pending = Buffer.concat([pending, c]);
          while (pending.length >= CHUNK) { pacer.push(levelOf(pending.subarray(0, CHUNK))); pending = pending.subarray(CHUNK); }
          play.stdin!.write(c);
        });
        dec.stdout!.on('end', () => {
          if (pending.length > 0) pacer.push(levelOf(pending));
          play.stdin!.end();
        });
        play.on('close', (code) => {
          if (code === 0) void pacer.idle().then(() => finish('done'));
          else finish({ failed: `${player.command} exited ${code ?? 'killed'}` });
        });
      });
    },
  };
}
