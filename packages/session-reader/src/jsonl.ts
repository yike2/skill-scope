import { readFile } from 'node:fs/promises';

import type { Warning } from './session.js';

export interface JsonlRecord {
  line: number;
  record: Record<string, unknown>;
}

// Rejects with the fs error when the file cannot be read. Blank lines are skipped silently; a line
// that is not a JSON object becomes a warning that holds no line text.
export async function readJsonl(path: string): Promise<(JsonlRecord | Warning)[]> {
  const text = await readFile(path, 'utf8');
  const out: (JsonlRecord | Warning)[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      out.push({ line, reason: 'invalid JSON' });
      return;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      out.push({ line, reason: 'line is not a JSON object' });
      return;
    }
    out.push({ line, record: value as Record<string, unknown> });
  });
  return out;
}
