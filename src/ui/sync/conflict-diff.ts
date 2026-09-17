export type ConflictDiffLine = {
  kind: 'same' | 'local' | 'drive';
  text: string;
};

const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_LINES = 400;

export function buildConflictDiff(localText: string, driveText: string): ConflictDiffLine[] | null {
  if (localText.length > MAX_TEXT_LENGTH || driveText.length > MAX_TEXT_LENGTH) return null;
  const local = localText.split('\n');
  const drive = driveText.split('\n');
  if (local.length > MAX_LINES || drive.length > MAX_LINES) return null;

  const rows = local.length + 1;
  const cols = drive.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = local.length - 1; i >= 0; i--) {
    for (let j = drive.length - 1; j >= 0; j--) {
      lcs[i][j] = local[i] === drive[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: ConflictDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < local.length && j < drive.length) {
    if (local[i] === drive[j]) {
      result.push({ kind: 'same', text: local[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: 'local', text: local[i] });
      i++;
    } else {
      result.push({ kind: 'drive', text: drive[j] });
      j++;
    }
  }
  while (i < local.length) result.push({ kind: 'local', text: local[i++] });
  while (j < drive.length) result.push({ kind: 'drive', text: drive[j++] });
  return result;
}

export function formatConflictDiff(lines: ConflictDiffLine[]): string {
  return lines.map(line => {
    const prefix = line.kind === 'same' ? '  ' : line.kind === 'local' ? '- ' : '+ ';
    return `${prefix}${line.text}`;
  }).join('\n');
}
