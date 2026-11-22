import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readJsonl } from './jsonl.js';

async function inline(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'session-reader-jsonl-'));
  const path = join(dir, 'log.jsonl');
  await writeFile(path, content);
  return path;
}

describe('readJsonl', () => {
  describe('line numbering and line endings', () => {
    it('J-01 returns one entry per object line with 1-based line numbers', async () => {
      const path = await inline('{"type":"a","n":1}\n{"type":"b","n":2}\n');

      expect(await readJsonl(path)).toEqual([
        { line: 1, record: { type: 'a', n: 1 } },
        { line: 2, record: { type: 'b', n: 2 } },
      ]);
    });

    it('J-02 skips an empty line without a warning and still counts it', async () => {
      const path = await inline('{"n":1}\n\n{"n":3}\n');

      expect(await readJsonl(path)).toEqual([
        { line: 1, record: { n: 1 } },
        { line: 3, record: { n: 3 } },
      ]);
    });

    it('J-03 parses CRLF line endings with the same line numbers and no warnings', async () => {
      const lf = await inline('{"n":1}\n\n{"n":3}\n');
      const crlf = await inline('{"n":1}\r\n\r\n{"n":3}\r\n');

      const result = await readJsonl(crlf);

      expect(result).toEqual(await readJsonl(lf));
      expect(result).toEqual([
        { line: 1, record: { n: 1 } },
        { line: 3, record: { n: 3 } },
      ]);
    });

    it('J-04 adds no entry and no warning for the empty segment after a trailing newline', async () => {
      const path = await inline('{"n":1}\n');

      expect(await readJsonl(path)).toEqual([{ line: 1, record: { n: 1 } }]);
    });

    it('J-05 parses a last line that has no trailing newline', async () => {
      const path = await inline('{"n":1}\n{"n":2}');

      expect(await readJsonl(path)).toEqual([
        { line: 1, record: { n: 1 } },
        { line: 2, record: { n: 2 } },
      ]);
    });

    it('J-06 returns nothing for an empty file', async () => {
      const path = await inline('');

      expect(await readJsonl(path)).toEqual([]);
    });

    it('J-11 skips a whitespace-only line without a warning and keeps line numbers', async () => {
      const path = await inline('{"n":1}\n   \t \n{"n":3}\n');

      expect(await readJsonl(path)).toEqual([
        { line: 1, record: { n: 1 } },
        { line: 3, record: { n: 3 } },
      ]);
    });
  });

  describe('malformed lines', () => {
    it('J-07 warns once for an invalid JSON line and keeps both valid records', async () => {
      const path = await inline('{"n":1}\n{"n": broken\n{"n":3}\n');

      const result = await readJsonl(path);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ line: 1, record: { n: 1 } });
      expect(result[1]).toEqual({ line: 2, reason: expect.any(String) });
      expect(result[2]).toEqual({ line: 3, record: { n: 3 } });
    });

    it('J-08 warns instead of returning a record for a JSON array line', async () => {
      const path = await inline('{"n":1}\n[1,2,3]\n');

      const result = await readJsonl(path);

      expect(result).toEqual([
        { line: 1, record: { n: 1 } },
        { line: 2, reason: expect.any(String) },
      ]);
    });

    it('J-09 warns once per JSON scalar line', async () => {
      const path = await inline('42\n"text"\nnull\n');

      const result = await readJsonl(path);

      expect(result).toEqual([
        { line: 1, reason: expect.any(String) },
        { line: 2, reason: expect.any(String) },
        { line: 3, reason: expect.any(String) },
      ]);
    });

    it('J-10 keeps the line text out of the warning reason', async () => {
      const path = await inline('{"secret": "J10_MARKER_TEXT", oops\n');

      const result = await readJsonl(path);

      expect(result).toHaveLength(1);
      const warning = result[0];
      expect(warning).toEqual({ line: 1, reason: expect.any(String) });
      const reason = warning && 'reason' in warning ? warning.reason : '';
      expect(reason).not.toContain('J10_MARKER_TEXT');
      expect(reason).not.toContain('secret');
      expect(reason).not.toContain('oops');
    });

    it('J-12 rejects with ENOENT for a path that does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'session-reader-jsonl-'));

      await expect(readJsonl(join(dir, 'missing.jsonl'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });
});
