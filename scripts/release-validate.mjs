import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function validateRelease() {
  const errors = [];
  const warnings = [];

  console.log('Validating release...');

  const isRelease = process.argv.includes('--release') || process.env.RELEASE_MODE === 'true';

  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  if (!version.match(/^\d+\.\d+\.\d+(-beta\.\d+)?$/)) {
    errors.push(`Invalid version format: ${version}. Expected X.Y.Z or X.Y.Z-beta.N`);
  }

  const requiredFiles = ['main.js', 'manifest.json'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(rootDir, file))) {
      errors.push(`Required build file missing: ${file}`);
    }
  }

  const manifestPath = path.join(rootDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== version) {
      errors.push(`Manifest version ${manifest.version} != package.json version ${version}`);
    }
  }

  const versionsPath = path.join(rootDir, 'versions.json');
  if (fs.existsSync(versionsPath)) {
    const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    if (!versions[version]) {
      warnings.push(`Version ${version} not listed in versions.json`);
    }
  }

  if (isRelease) {
    const configSrc = path.join(rootDir, 'src/main.ts');
    if (fs.existsSync(configSrc)) {
      const content = fs.readFileSync(configSrc, 'utf8');
      if (content.includes('PLACEHOLDER_CLIENT_ID')) {
        errors.push('OAuth Client ID is placeholder. Set real Desktop OAuth Client ID for release.');
      }
    }

    if (!version.match(/^\d+\.\d+\.\d+$/)) {
      errors.push('Release version must not be pre-release (no -beta suffix).');
    }

    const gitTag = process.env.GITHUB_REF_NAME || '';
    if (gitTag && gitTag !== version) {
      errors.push(`Git tag "${gitTag}" does not match version "${version}".`);
    }
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log(`  warn: ${w}`));
  }

  if (errors.length > 0) {
    console.log('\nValidation failed:');
    errors.forEach(e => console.log(`  error: ${e}`));
    process.exit(1);
  }

  console.log('\nValidation passed!');
  process.exit(0);
}

validateRelease();
