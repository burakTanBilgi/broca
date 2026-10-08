import { createLineFinder } from './lines.ts';
import { listenMic } from './mic.ts';
import { createScreen, floorOf, render } from './pane.ts';
import type { PaneState } from './pane.ts';
import { loadSettings } from './settings.ts';
import { createSpeaker } from './speaker.ts';
import { followTranscript, openChat } from './transcript.ts';
import { createEdgeMouth } from './voice.ts';

const USAGE = `broca — speaks one Claude Code chat's » lines and draws both voices

  broca <session-id>          follow that chat
  broca --cwd <dir>           follow the newest chat started in that folder
  broca --say "<text>"        say one line and exit (a voice check)
  broca --projects <dir>      look for chats there instead of ~/.claude/projects

keys: space stops the current speech · m mutes · q quits
settings: ~/.config/broca/settings.json (see README.md)`;

interface Args { sessionId?: string; cwd?: string; projectsDir?: string; say?: string; help: boolean }

export function parseArgs(argv: string[]): Args {
  const a: Args = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`${arg} needs a value\n\n${USAGE}`); return v; };
    if (arg === '--help' || arg === '-h') a.help = true;
    else if (arg === '--cwd') a.cwd = value();
    else if (arg === '--projects') a.projectsDir = value();
    else if (arg === '--say') a.say = value();
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}\n\n${USAGE}`);
    else a.sessionId = arg;
  }
  if (!a.help && a.say === undefined && a.sessionId === undefined && a.cwd === undefined) throw new Error(USAGE);
  return a;
}

const KEEP = 400;          // levels kept per wave: 40 s at 10 a second
const NOTE_MS = 6000;

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return; }
  const settings = loadSettings();
  if (args.projectsDir !== undefined) settings.projectsDir = args.projectsDir;
  const mouth = createEdgeMouth({ ttsCommand: settings.ttsCommand, ttsArgs: settings.ttsArgs, voice: settings.voice, player: settings.player });

  if (args.say !== undefined) {
    const result = await mouth.speak(args.say, { signal: new AbortController().signal, onLevel: () => {} });
    if (result !== 'done') { console.error(typeof result === 'string' ? result : result.failed); process.exitCode = 1; }
    return;
  }

  const chat = openChat({ sessionId: args.sessionId, cwd: args.cwd, projectsDir: settings.projectsDir });
  const state: PaneState = { name: chat.name, state: 'quiet', you: [], me: [], line: null, note: null, muted: false, width: 80 };
  const push = (levels: number[], level: number): void => { levels.push(level); if (levels.length > KEEP) levels.shift(); };
  let clearTimer: NodeJS.Timeout | null = null;
  let noteTimer: NodeJS.Timeout | null = null;
  const note = (text: string): void => {
    state.note = text;
    if (noteTimer !== null) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { state.note = null; }, NOTE_MS);
  };

  let lastMeAt = 0;
  let speechEndedAt = 0;
  const speaker = createSpeaker(mouth, {
    onStart(text) {
      if (clearTimer !== null) clearTimeout(clearTimer);
      state.line = text;
      state.state = 'speaking';
    },
    onEnd(text, result) {
      state.state = 'quiet';
      speechEndedAt = Date.now();
      if (typeof result !== 'string') note(result.failed);
      clearTimer = setTimeout(() => { if (state.line === text) state.line = null; }, settings.clearAfterMs);
    },
    onLevel(level) { lastMeAt = Date.now(); push(state.me, level); },
  });

  const recentMic: number[] = [];
  const talking = (): boolean => { const floor = floorOf(state.you); return recentMic.some((v) => v > floor * settings.listenRatio); };
  let micAlive = true;
  const mic = listenMic({
    onLevel(raw) {
      // The microphone hears the speakers: hold the you wave flat while Broca talks, unless voiceStop needs to hear you over it.
      const echo = !settings.voiceStop && (speaker.speaking || Date.now() - speechEndedAt < 300);
      const level = echo ? 0 : raw;
      push(state.you, level);
      recentMic.push(level);
      if (recentMic.length > 3) recentMic.shift();
      if (settings.voiceStop && speaker.speaking && recentMic.length === 3 && recentMic.every((v) => v > floorOf(state.you) * settings.listenRatio)) speaker.stop();
    },
    onError(reason) { micAlive = false; note(reason); },
  });

  const finder = createLineFinder();
  const follower = followTranscript(chat.file, (record) => { for (const line of finder.next(record)) speaker.say(line); }, { fromOffset: chat.size });

  const screen = createScreen({
    onKey(key) {
      if (key === 'space') speaker.stop();
      else if (key === 'm') { speaker.setMuted(!speaker.muted); state.muted = speaker.muted; }
      else quit();
    },
    onResize: () => draw(),
  });
  const draw = (): void => {
    state.width = screen.width();
    if (state.state !== 'speaking') state.state = talking() ? 'listening' : 'quiet';
    screen.draw(render(state));
  };
  const ticker = setInterval(() => {
    if (Date.now() - lastMeAt > 150) push(state.me, 0);
    if (!micAlive) push(state.you, 0);
    draw();
  }, 100);
  const quit = (): void => {
    clearInterval(ticker);
    follower.stop();
    mic.stop();
    speaker.stop();
    screen.close();
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  draw();
}
