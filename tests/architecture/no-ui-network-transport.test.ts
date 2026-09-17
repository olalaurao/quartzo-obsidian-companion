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
    const forbidden: Array<{ label: string; pattern: RegExp }> = [
      { label: 'node:http import', pattern: /from\s+['"]node:http['"]/ },
      { label: 'node:https import', pattern: /from\s+['"]node:https['"]/ },
      { label: 'secureRemoteFetch', pattern: /\bsecureRemoteFetch\s*\(/ },
      { label: 'requestUrl', pattern: /\brequestUrl\s*\(/ },
      // Service methods such as resourceMetadataService.fetch() are allowed;
      // a direct/global fetch() call is not.
      { label: 'raw fetch', pattern: /(^|[^\w.])fetch\s*\(/m },
    ];
    const violations: string[] = [];
    for (const file of typescriptFiles(uiRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.pattern.test(source)) {
          violations.push(`${path.relative(process.cwd(), file)}: ${rule.label}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
