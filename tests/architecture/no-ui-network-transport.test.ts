import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function typescriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('UI network architecture', () => {
  it('keeps transport and raw network APIs outside src/ui', () => {
    const uiRoot = path.resolve('src/ui');
    const forbidden = [
      "from 'node:http'",
      "from 'node:https'",
      'secureRemoteFetch(',
      'requestUrl(',
      'fetch(',
    ];
    const violations: string[] = [];
    for (const file of typescriptFiles(uiRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (source.includes(pattern)) violations.push(`${path.relative(process.cwd(), file)}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
