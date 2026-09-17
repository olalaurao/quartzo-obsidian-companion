import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const artifactDir = path.join(rootDir, '.release-artifact');
const assets = ['main.js', 'manifest.json', 'styles.css'];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

fs.rmSync(artifactDir, { recursive: true, force: true });
fs.mkdirSync(artifactDir, { recursive: true });

const checksums = [];
for (const asset of assets) {
  const source = path.join(rootDir, asset);
  if (!fs.existsSync(source)) {
    console.error(`FAIL: release asset missing: ${asset}`);
    process.exit(1);
  }
  const target = path.join(artifactDir, asset);
  fs.copyFileSync(source, target);
  checksums.push(`${sha256(target)}  ${asset}`);
}

fs.writeFileSync(path.join(artifactDir, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8');
console.log(`Release artifact staged at ${artifactDir}`);
