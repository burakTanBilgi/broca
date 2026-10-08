// The speaker: lines go in, the mouth says them one at a time and in order. Stop drops what is waiting and cuts what is
// being said. Muted, a line is still shown (onStart/onEnd fire) but the mouth is not called.
import type { Mouth, SpeakResult } from './voice.ts';

export interface SpeakerEvents { onStart(text: string): void; onEnd(text: string, result: SpeakResult): void; onLevel(level: number): void }
export interface Speaker { say(text: string): void; stop(): void; setMuted(on: boolean): void; readonly muted: boolean; readonly speaking: boolean }

export function createSpeaker(mouth: Mouth, ev: SpeakerEvents): Speaker {
  const queue: string[] = [];
  let muted = false;
  let running: AbortController | null = null;
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
        ev.onStart(text);
        if (muted) { ev.onEnd(text, 'done'); continue; }
        const controller = new AbortController();
        running = controller;
        let result: SpeakResult;
        try {
          result = await mouth.speak(text, { signal: controller.signal, onLevel: ev.onLevel });
        } catch (e) {
          result = { failed: e instanceof Error ? e.message : String(e) };
        }
        running = null;
        ev.onEnd(text, controller.signal.aborted ? 'stopped' : result);
      }
    } finally {
      draining = false;
    }
  }

  return {
    say(text) { queue.push(text); void drain(); },
    stop() { queue.length = 0; running?.abort(); },
    setMuted(on) { muted = on; if (on) running?.abort(); },
    get muted() { return muted; },
    get speaking() { return running !== null; },
  };
}
