import { describe, expect, it } from 'vitest';
import { buildPairingDiagnosticsText } from '../../src/ui/sync/pairing-diagnostics';
import type { PairingSummary } from '../../src/sync/coordinator';

describe('pairing diagnostics', () => {
  it('includes blocked paths and every remote candidate identity', () => {
    const summary: PairingSummary = {
      identical: [],
      remoteOnly: [],
      localOnly: [],
      divergent: [],
      ambiguous: [
        {
          path: 'Projects/dup.md',
          status: 'ambiguous',
          localHash: 'hash-a',
          remoteHash: null,
          remoteCandidates: [
            {
              id: 'drive-a',
              modifiedTime: '2026-09-17T10:00:00.000Z',
              quartzoHash: 'hash-a',
              resolvedSha256: 'hash-a',
              matchesLocal: true,
            },
            {
              id: 'drive-b',
              modifiedTime: '2026-09-18T10:00:00.000Z',
              quartzoHash: null,
              resolvedSha256: 'hash-b',
              matchesLocal: false,
            },
          ],
        },
      ],
    };

    const text = buildPairingDiagnosticsText('os', summary);

    expect(text).toContain('Folder: os');
    expect(text).toContain('Ambiguous: 1');
    expect(text).toContain('Projects/dup.md');
    expect(text).toContain('localSha256: hash-a');
    expect(text).toContain('candidateContent: 2 distinct contents');
    expect(text).toContain('candidatesMatchingLocal: 1');
    expect(text).toContain('id: drive-a');
    expect(text).toContain('modifiedTime: 2026-09-17T10:00:00.000Z');
    expect(text).toContain('Quartzo_hash: hash-a');
    expect(text).toContain('resolvedSha256: hash-a');
    expect(text).toContain('matchesLocal: yes');
    expect(text).toContain('id: drive-b');
    expect(text).toContain('Quartzo_hash: missing');
    expect(text).toContain('resolvedSha256: hash-b');
    expect(text).toContain('matchesLocal: no');
  });
});
