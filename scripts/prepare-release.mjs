import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const requestedVersion = process.argv[2];

if (!requestedVersion || !/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(requestedVersion)) {
  console.error('Usage: npm run release:prepare -- <X.Y.Z|X.Y.Z-beta.N>');
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const packageJson = readJson('package.json');
const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

if (!manifest.minAppVersion) {
  console.error('manifest.json is missing minAppVersion. Refusing to prepare a release.');
  process.exit(1);
}

packageJson.version = requestedVersion;
manifest.version = requestedVersion;
versions[requestedVersion] = manifest.minAppVersion;

writeJson('package.json', packageJson);
writeJson('manifest.json', manifest);
writeJson('versions.json', versions);

if (fs.existsSync(packageLockPath)) {
  const packageLock = readJson('package-lock.json');
  packageLock.version = requestedVersion;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = requestedVersion;
  }
  writeJson('package-lock.json', packageLock);
}

console.log(`Prepared release metadata for ${requestedVersion}`);
console.log('Updated package.json, manifest.json, versions.json, and package-lock.json when present.');
console.log('Next: run CI/release validation, merge to main, run Release Preflight on that exact commit, then create the matching tag.');
