import type { Warning } from './session.js';

export interface JsonlRecord {
  line: number;
  record: Record<string, unknown>;
}

export async function readJsonl(path: string): Promise<(JsonlRecord | Warning)[]> {
  void path;
  throw new Error('not implemented');
}
