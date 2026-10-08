// Settings: defaults, then ~/.config/broca/settings.json on top, key by key, each only when its type is right.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROJECTS_DIR } from './transcript.ts';

export interface Settings {
  voice: string;                 // an edge-tts voice; a Multilingual one says Turkish too
  ttsCommand: string; ttsArgs: string[];
  player: 'pw-play' | 'mpv';
  voiceStop: boolean;            // cut speech when you start talking: off, speakers would feed Broca's voice back
  listenRatio: number;           // how many times louder than the room's noise counts as you talking
  clearAfterMs: number;          // how long the sentence stays on the pane after it ends
  projectsDir: string;
}

export const SETTINGS_FILE = join(homedir(), '.config', 'broca', 'settings.json');
export const DEFAULT_SETTINGS: Settings = {
  voice: 'en-US-BrianMultilingualNeural', ttsCommand: 'uvx', ttsArgs: ['edge-tts@7.2.8'], player: 'pw-play',
  voiceStop: false, listenRatio: 3, clearAfterMs: 3000, projectsDir: DEFAULT_PROJECTS_DIR,
};

export function loadSettings(file = SETTINGS_FILE): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ttsArgs: [...DEFAULT_SETTINGS.ttsArgs] };
  if (!existsSync(file)) return s;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`); }
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.voice === 'string') s.voice = r.voice;
  if (typeof r.ttsCommand === 'string') s.ttsCommand = r.ttsCommand;
  if (Array.isArray(r.ttsArgs) && r.ttsArgs.every((a) => typeof a === 'string')) s.ttsArgs = r.ttsArgs as string[];
  if (r.player === 'pw-play' || r.player === 'mpv') s.player = r.player;
  if (typeof r.voiceStop === 'boolean') s.voiceStop = r.voiceStop;
  if (typeof r.listenRatio === 'number' && r.listenRatio >= 1.5) s.listenRatio = r.listenRatio;
  if (typeof r.clearAfterMs === 'number' && r.clearAfterMs >= 0) s.clearAfterMs = r.clearAfterMs;
  if (typeof r.projectsDir === 'string') s.projectsDir = r.projectsDir;
  return s;
}
