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
      lines.push(`- ${item.path}`);
      const candidates = item.remoteCandidates ?? [];
      for (const candidate of candidates) {
        lines.push(
          `  - id: ${candidate.id}`,
          `    modifiedTime: ${candidate.modifiedTime ?? 'unknown'}`,
          `    Quartzo_hash: ${candidate.quartzoHash ?? 'missing'}`
        );
      }
    }
  }

  return lines.join('\n');
}
