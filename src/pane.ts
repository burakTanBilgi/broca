// The pane: one box, text only. `render` is pure (rows of equal width, tested); `createScreen` owns the terminal.
import { scrub } from './lines.ts';

export const BARS = '▁▂▃▄▅▆▇█';
const MAX_INNER = 76;
const MIN_INNER = 20;
const ESC = '\x1b[';
const C = { frame: `${ESC}38;5;240m`, you: `${ESC}38;5;75m`, me: `${ESC}38;5;215m`, dim: `${ESC}2m`, bold: `${ESC}1m`, reset: `${ESC}0m` };

export type State = 'quiet' | 'listening' | 'speaking';
export interface PaneState { name: string; state: State; you: number[]; me: number[]; line: string | null; note: string | null; muted: boolean; width: number }

// A 0..1 value onto the eight blocks.
export function bar(norm: number): string {
  const i = Math.floor(norm * 8);
  return BARS[Math.max(0, Math.min(BARS.length - 1, i))]!;
}

// The room's noise: the quietest sounding level of the last 50 (zeros are a gate, not a room), never below a thousandth.
export function floorOf(levels: number[]): number {
  const sounding = levels.slice(-50).filter((v) => v > 0);
  return Math.max(0.001, sounding.length === 0 ? 0.001 : Math.min(...sounding));
}

// Each level is drawn between the noise floor and the loudest level drawn, so any microphone gain shows a voice.
export function wave(levels: number[], width: number): string {
  if (width <= 0) return '';
  const floor = floorOf(levels);
  const drawn = levels.slice(-width);
  const peak = drawn.length === 0 ? 0 : Math.max(...drawn);
  const tail = drawn.map((v) => (peak < floor * 2 ? BARS[0]! : bar((v - floor) / (peak - floor)))).join('');
  return BARS[0]!.repeat(width - [...tail].length) + tail;
}

export function wrapWords(text: string, width: number, maxRows: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    let w = word;
    while ([...w].length > width) {                         // a word longer than the row is cut
      if (row !== '') { rows.push(row); row = ''; }
      rows.push([...w].slice(0, width).join(''));
      w = [...w].slice(width).join('');
    }
    if (row === '') row = w;
    else if ([...row].length + 1 + [...w].length <= width) row += ' ' + w;
    else { rows.push(row); row = w; }
  }
  if (row !== '') rows.push(row);
  if (rows.length > maxRows) {
    const rest = [...rows.slice(maxRows - 1).join(' ')];    // what is left, joined, then cut to one row
    return [...rows.slice(0, maxRows - 1), rest.slice(0, width - 1).join('') + '…'];
  }
  return rows;
}

const cut = (text: string, width: number): string => ([...text].length <= width ? text : [...text].slice(0, Math.max(0, width - 1)).join('') + '…');

export function render(s: PaneState, colour = true): string[] {
  const c = (code: string, text: string): string => (colour ? code + text + C.reset : text);
  const inner = Math.max(MIN_INNER, Math.min(s.width - 5, MAX_INNER));   // content columns; a row is inner + 5 wide
  const row = (content: string, plainWidth: number): string =>
    ' ' + c(C.frame, '│') + ' ' + content + ' '.repeat(Math.max(0, inner - plainWidth)) + ' ' + c(C.frame, '│');
  const stateWord = s.muted ? `${s.state} · muted` : s.state;
  const title = cut(`broca · ${scrub(s.name)}`, inner - [...stateWord].length - 3);
  const dashes = inner - [...title].length - [...stateWord].length - 2;
  const rows = [' ' + c(C.frame, '┌ ') + c(C.bold, title) + ' ' + c(C.frame, '─'.repeat(dashes)) + ' ' + c(C.dim, stateWord) + c(C.frame, ' ┐')];
  const w = inner - 6;
  rows.push(row('you   ' + c(C.you, wave(s.you, w)), inner));
  rows.push(row('me    ' + c(C.me, wave(s.me, w)), inner));
  rows.push(row('', 0));
  const said = s.line === null ? [] : wrapWords(scrub(s.line), inner - 2, 3);
  for (let i = 0; i < 3; i++) {
    const text = said[i] === undefined ? '' : (i === 0 ? '"' : ' ') + said[i] + (i === said.length - 1 ? '"' : '');
    rows.push(row(text, [...text].length));
  }
  const note = s.note === null ? '' : cut(scrub(s.note), inner);
  rows.push(row(c(C.dim, note), [...note].length));
  const keys = cut(`space: stop · m: ${s.muted ? 'unmute' : 'mute'} · q: quit`, inner);
  rows.push(row(c(C.dim, keys), [...keys].length));
  rows.push(' ' + c(C.frame, '└' + '─'.repeat(inner + 2) + '┘'));
  return rows;
}

// Alternate screen, cursor hidden, raw keys. Everything is undone by close().
export function createScreen(o: { onKey(key: 'space' | 'm' | 'q'): void; onResize(): void }): { draw(rows: string[]): void; width(): number; close(): void } {
  const out = process.stdout;
  const inp = process.stdin;
  out.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  if (inp.isTTY) inp.setRawMode(true);
  inp.setEncoding('utf8');
  inp.resume();
  const onData = (data: string): void => {
    for (const ch of data) {
      if (ch === ' ') o.onKey('space');
      else if (ch === 'm' || ch === 'M') o.onKey('m');
      else if (ch === 'q' || ch === 'Q' || ch === '\u0003') o.onKey('q');
    }
  };
  inp.on('data', onData);
  out.on('resize', o.onResize);
  return {
    draw(rows) { out.write(`${ESC}H` + rows.map((r) => r + `${ESC}K`).join('\r\n') + `\r\n${ESC}J`); },
    width() { return out.columns ?? 80; },
    close() {
      inp.off('data', onData);
      out.off('resize', o.onResize);
      if (inp.isTTY) inp.setRawMode(false);
      inp.pause();
      out.write(`${ESC}?25h${ESC}?1049l`);
    },
  };
}
