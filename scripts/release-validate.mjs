import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function validateRelease() {
  const errors = [];
  const warnings = [];

  console.log('Validating release...');

  // Check if this is a release build
  const isRelease = process.argv.includes('--release') || process.env.RELEASE_MODE === 'true';

  // Check version format
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  if (!version.match(/^\d+\.\d+\.\d+(-beta\.\d+)?$/)) {
    errors.push(`Invalid version format: ${version}. Expected format: X.Y.Z or X.Y.Z-beta.N`);
  }

  // Check build outputs
  const buildDir = path.join(rootDir);
  const requiredFiles = ['main.js', 'manifest.json'];
  
  for (const file of requiredFiles) {
    const filePath = path.join(buildDir, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`Required build file missing: ${file}`);
    }
  }

  // Check styles.css (optional but recommended)
  const stylesPath = path.join(buildDir, 'styles.css');
  if (!fs.existsSync(stylesPath)) {
    warnings.push('styles.css not found (optional but recommended)');
  }

  // Check manifest.json
  const manifestPath = path.join(buildDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== version) {
      errors.push(`Manifest version ${manifest.version} does not match package.json version ${version}`);
    }
  }

  // Check for placeholder OAuth in release mode
  if (isRelease) {
    const oauthConfigPath = path.join(rootDir, 'src/core/oauth/config.ts');
    if (fs.existsSync(oauthConfigPath)) {
      const oauthConfig = fs.readFileSync(oauthConfigPath, 'utf8');
      if (oauthConfig.includes('PLACEHOLDER') || oauthConfig.includes('YOUR_CLIENT_ID')) {
        errors.push('OAuth configuration contains placeholder values. Replace with real Desktop Google OAuth Client ID for release.');
      }
    }
  }

  // Report results
  if (warnings.length > 0) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  }

  if (errors.length > 0) {
    console.log('\n❌ Validation failed:');
    errors.forEach(e => console.log(`  🔴 ${e}`));
    process.exit(1);
  }

  console.log('\n✅ Validation passed!');
  process.exit(0);
}

validateRelease();
