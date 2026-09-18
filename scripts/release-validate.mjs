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

  const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
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
    if (manifest.id !== 'quartzo-obsidian-companion') {
      errors.push(`Unexpected manifest id: ${manifest.id}`);
    }
    if (manifest.isDesktopOnly !== true) {
      errors.push('Quartzo Companion must remain desktop-only.');
    }
  }

  const versionsPath = path.join(rootDir, 'versions.json');
  if (fs.existsSync(versionsPath)) {
    const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    if (!versions[version]) {
      errors.push(`Version ${version} not listed in versions.json`);
    } else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (versions[version] !== manifest.minAppVersion) {
        errors.push(`versions.json maps ${version} to ${versions[version]}, but manifest minAppVersion is ${manifest.minAppVersion}`);
      }
    }
  } else {
    errors.push('versions.json is required for a release.');
  }

  if (isRelease) {
    const clientIdEnv = process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_ID;
    const clientSecretEnv = process.env.QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET;
    if (!clientIdEnv || clientIdEnv === 'PLACEHOLDER_CLIENT_ID') {
      errors.push('OAuth Client ID is missing. Set QUARTZO_GOOGLE_DESKTOP_CLIENT_ID for release.');
    } else if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientIdEnv)) {
      errors.push('QUARTZO_GOOGLE_DESKTOP_CLIENT_ID does not look like a Google Desktop OAuth Client ID.');
    }
    if (!clientSecretEnv) {
      errors.push('OAuth Client Secret is missing. Set QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET for release.');
    }

    const mainJsPath = path.join(rootDir, 'main.js');
    if (fs.existsSync(mainJsPath)) {
      const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
      if (clientIdEnv && clientIdEnv !== 'PLACEHOLDER_CLIENT_ID' && !mainJsContent.includes(clientIdEnv)) {
        errors.push('Built main.js does not contain QUARTZO_GOOGLE_DESKTOP_CLIENT_ID value. Build must inject the env var.');
      }
      if (clientSecretEnv && !mainJsContent.includes(clientSecretEnv)) {
        errors.push('Built main.js does not contain QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET value. Build must inject the env var.');
      }
      if (mainJsContent.includes("require('googleapis')") && !mainJsContent.includes('const GoogleApis = require')) {
        errors.push('Built main.js contains unresolved runtime require("googleapis"). googleapis must be bundled.');
      }
    }

    const manifestPath2 = path.join(rootDir, 'manifest.json');
    if (fs.existsSync(manifestPath2)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath2, 'utf8'));
      const minVersion = manifest.minAppVersion;
      const parseVersion = value => String(value).split('.').map(part => Number(part));
      const compareVersions = (left, right) => {
        const a = parseVersion(left);
        const b = parseVersion(right);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          const delta = (a[i] || 0) - (b[i] || 0);
          if (delta !== 0) return delta;
        }
        return 0;
      };
      if (!minVersion || compareVersions(minVersion, '1.11.4') < 0) {
        errors.push(`minAppVersion ${minVersion || '(missing)'} is too low. Must be >= 1.11.4 for app.secretStorage support.`);
      }
    }

    const isBetaRelease = version.match(/^\d+\.\d+\.\d+-beta\.\d+$/);
    const isStableRelease = version.match(/^\d+\.\d+\.\d+$/);
    if (!isBetaRelease && !isStableRelease) {
      errors.push('Release version must be X.Y.Z or X.Y.Z-beta.N.');
    }

    const gitRefType = process.env.GITHUB_REF_TYPE || '';
    const gitTag = process.env.GITHUB_REF_NAME || '';
    if (gitRefType === 'tag' && gitTag !== version) {
      errors.push(`Git tag "${gitTag || '(missing)'}" does not match version "${version}".`);
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
