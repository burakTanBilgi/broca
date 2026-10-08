// The line finder: which parts of a transcript record Broca speaks. The rule (docs/rule.md): a paragraph in the
// assistant's text that begins with "» " (U+00BB, one space) at the start of a line. Nothing else is spoken.
export const MARK = '» ';

// Control characters (ESC, bell, and the like) become spaces, so a line cannot drive the terminal.
export const scrub = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();

// Lines inside a ``` or ~~~ fence are the chat showing something, not saying it. A fence closes only with its own kind.
export function spokenLinesInText(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const kind = /^\s*(```|~~~)/.exec(line)?.[1];
    if (kind !== undefined && (fence === null || fence === kind)) { fence = fence === null ? kind : null; continue; }
    if (fence !== null || !line.startsWith(MARK)) continue;
    const said = scrub(line.slice(MARK.length));
    if (said !== '') out.push(said);
  }
  return out;
}

export function spokenLines(record: unknown): string[] {
  if (typeof record !== 'object' || record === null) return [];
  const r = record as { type?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
  if (r.type !== 'assistant' || r.isSidechain === true) return [];
  const content = r.message?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') out.push(...spokenLinesInText(b.text));
  }
  return out;
}

// Speaks each record once, by its uuid, in case the file shows one twice.
export function createLineFinder(): { next(record: unknown): string[] } {
  const seen = new Set<string>();
  return {
    next(record) {
      const uuid = typeof record === 'object' && record !== null ? (record as { uuid?: unknown }).uuid : undefined;
      if (typeof uuid === 'string') {
        if (seen.has(uuid)) return [];
        seen.add(uuid);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
      }
      return spokenLines(record);
    },
  };
}
