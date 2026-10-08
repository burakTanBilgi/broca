// The transcript: where a chat's .jsonl lives, what the chat is called, and how to follow it as the chat appends to it.
// Claude Code appends one JSON record per line; an assistant text block arrives as one whole line (checked in docs/spikes.md).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

export interface Chat { file: string; sessionId: string; name: string; size: number }
export interface Follower { stop(): void; readonly offset: number }

// Claude Code names a project folder after the working directory with every character outside A-Z a-z 0-9 turned into '-'.
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function listDirs(projects: string): string[] {
  try {
    return readdirSync(projects, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    throw new Error(`no Claude Code projects folder at ${projects}`);
  }
}

function listSessionFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && SESSION_FILE.test(e.name)).map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

export function findTranscript(o: { sessionId?: string; cwd?: string; projectsDir?: string }): string {
  const projects = o.projectsDir ?? DEFAULT_PROJECTS_DIR;
  if (o.sessionId !== undefined) {
    const name = `${o.sessionId}.jsonl`;
    for (const dir of listDirs(projects)) {
      const file = join(projects, dir, name);
      if (existsSync(file)) return file;
    }
    throw new Error(`no chat ${o.sessionId} under ${projects}`);
  }
  if (o.cwd !== undefined) {
    const dir = join(projects, projectSlug(o.cwd));
    const files = listSessionFiles(dir);
    if (files.length === 0) throw new Error(`no chat for ${o.cwd} (looked in ${dir})`);
    return files.map((f) => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t)[0]!.f;
  }
  throw new Error('give a session id or --cwd <dir>');
}

// Whole lines become records; a line that is not JSON (half-written, foreign) is skipped; the trailing partial line is returned.
export function parseLines(text: string): { records: unknown[]; rest: string } {
  const parts = text.split('\n');
  const rest = parts.pop() ?? '';
  const records: unknown[] = [];
  for (const line of parts) {
    if (line.trim() === '') continue;
    try { records.push(JSON.parse(line)); } catch { /* skipped */ }
  }
  return { records, rest };
}

const str = (o: Record<string, unknown>, key: string): string | null => (typeof o[key] === 'string' ? (o[key] as string) : null);

export function chatName(records: unknown[]): string | null {
  let agent: string | null = null;
  let custom: string | null = null;
  let ai: string | null = null;
  for (const r of records) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (o.type === 'agent-name') agent = str(o, 'agentName') ?? agent;
    else if (o.type === 'custom-title') custom = str(o, 'customTitle') ?? custom;
    else if (o.type === 'ai-title') ai = str(o, 'aiTitle') ?? ai;
  }
  return agent ?? custom ?? ai;
}

// Reads the file once: the name comes from the whole file, the size is the offset just after its last whole line, so a
// line being written at this very moment is read in full by the follower.
export function openChat(o: { sessionId?: string; cwd?: string; projectsDir?: string }): Chat {
  const file = findTranscript(o);
  const buf = readFileSync(file);
  const size = buf.lastIndexOf(0x0a) + 1;
  const { records } = parseLines(buf.subarray(0, size).toString('utf8'));
  const sessionId = basename(file, '.jsonl');
  return { file, sessionId, name: chatName(records) ?? sessionId.slice(0, 8), size };
}

// Polls the size every interval (and at once on an inotify event), reads what was appended, emits whole records.
// A file that got shorter was replaced: reading starts over from its beginning.
export function followTranscript(file: string, onRecord: (record: unknown) => void, o: { fromOffset: number; intervalMs?: number }): Follower {
  let offset = o.fromOffset;
  let decoder = new StringDecoder('utf8');
  let rest = '';
  let busy = false;
  const check = (): void => {
    if (busy) return;
    busy = true;
    try {
      let size: number;
      try { size = statSync(file).size; } catch { return; }          // gone for a moment: next tick
      if (size < offset) { offset = 0; rest = ''; decoder = new StringDecoder('utf8'); }
      if (size === offset) return;
      const fd = openSync(file, 'r');
      try {
        const buf = Buffer.alloc(size - offset);
        const n = readSync(fd, buf, 0, buf.length, offset);
        offset += n;
        const parsed = parseLines(rest + decoder.write(buf.subarray(0, n)));
        rest = parsed.rest;
        for (const r of parsed.records) onRecord(r);
      } finally {
        closeSync(fd);
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(check, o.intervalMs ?? 150);
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(file, () => check());
    watcher.on('error', () => { /* polling carries on */ });
  } catch { /* polling alone */ }
  return { stop() { clearInterval(timer); watcher?.close(); }, get offset() { return offset; } };
}
