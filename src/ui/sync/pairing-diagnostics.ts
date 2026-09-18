import type { PairingSummary } from '../../sync/coordinator';

export function buildPairingDiagnosticsText(folderName: string, summary: PairingSummary): string {
  const lines = [
    'Quartzo Companion pairing diagnostics',
    `Folder: ${folderName}`,
    `Divergent: ${summary.divergent.length}`,
    `Ambiguous: ${summary.ambiguous.length}`,
  ];

  if (summary.divergent.length > 0) {
    lines.push('', 'Divergent paths:');
    for (const item of summary.divergent) {
      lines.push(
        `- ${item.path}`,
        `  localHash: ${item.localHash ?? 'unknown'}`,
        `  remoteHash: ${item.remoteHash ?? 'unknown'}`,
        `  remoteFileId: ${item.remoteFileId ?? 'unknown'}`
      );
    }
  }

  if (summary.ambiguous.length > 0) {
    lines.push('', 'Ambiguous paths:');
    for (const item of summary.ambiguous) {
      const candidates = item.remoteCandidates ?? [];
      const distinctHashes = new Set(candidates.map(candidate => candidate.resolvedSha256));
      const matchingLocal = candidates.filter(candidate => candidate.matchesLocal === true).length;
      lines.push(
        `- ${item.path}`,
        `  localSha256: ${item.localHash ?? 'no local copy'}`,
        `  candidateContent: ${distinctHashes.size <= 1 ? 'all candidates byte-identical' : `${distinctHashes.size} distinct contents`}`,
        `  candidatesMatchingLocal: ${item.localHash == null ? 'n/a' : matchingLocal}`
      );
      for (const candidate of candidates) {
        lines.push(
          `  - id: ${candidate.id}`,
          `    modifiedTime: ${candidate.modifiedTime ?? 'unknown'}`,
          `    Quartzo_hash: ${candidate.quartzoHash ?? 'missing'}`,
          `    resolvedSha256: ${candidate.resolvedSha256}`,
          `    matchesLocal: ${candidate.matchesLocal == null ? 'n/a' : candidate.matchesLocal ? 'yes' : 'no'}`,
          `    canTrash: ${candidate.canTrash == null ? 'unknown' : candidate.canTrash ? 'yes' : 'no'}`
        );
      }
    }
  }

  return lines.join('\n');
}
