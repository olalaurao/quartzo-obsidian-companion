import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Critical production paths that must not contain empty implementations
const criticalPaths = [
  {
    path: 'src/sync/coordinator/index.ts',
    forbiddenPatterns: ['// 1. Get local hash', '// 2. Get remote hash', '// TODO: implement', '// FIXME: implement'],
    description: 'DriveSyncCoordinator'
  },
  {
    path: 'src/integrations/google/drive/adapter.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement', 'throw new Error("Not implemented")'],
    description: 'GoogleDriveAdapter'
  },
  {
    path: 'src/integrations/google/auth/loopback.ts',
    forbiddenPatterns: ['// Extract code and state from req.url', '// Resolve with code', '// open browser with auth URL'],
    description: 'OAuth loopback'
  },
  {
    path: 'src/main.ts',
    forbiddenPatterns: ['// TODO: implement', '// FIXME: implement'],
    description: 'Plugin main (composition root)'
  }
];

function checkFile(filePath, forbiddenPatterns, description) {
  const fullPath = path.join(rootDir, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ FAIL: ${description} file not found: ${filePath}`);
    return false;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const violations = [];

  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      violations.push(pattern);
    }
  }

  if (violations.length > 0) {
    console.error(`❌ FAIL: ${description} contains forbidden patterns:`);
    violations.forEach(v => console.error(`   - ${v}`));
    return false;
  }

  console.log(`✅ PASS: ${description} has no forbidden patterns`);
  return true;
}

function checkSystemsRoutinesSafety() {
  // Ensure no auto-executing Systems/Routines
  const srcDir = path.join(rootDir, 'src');
  
  function scanDirectory(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        scanDirectory(fullPath);
      } else if (file.name.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Check for dangerous auto-execution patterns
        const dangerousPatterns = [
          /setInterval.*System|setInterval.*Routine/,
          /auto.*execute.*System|auto.*execute.*Routine/i,
          /background.*execute.*System|background.*execute.*Routine/i,
          /custom_script.*execute/i
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(content)) {
            console.error(`❌ FAIL: Dangerous auto-execution pattern found in ${fullPath}`);
            return false;
          }
        }
      }
    }
  }

  scanDirectory(srcDir);
  console.log('✅ PASS: No dangerous auto-execution patterns found');
  return true;
}

function main() {
  console.log('Running architecture/completeness checks...\n');

  let allPassed = true;

  // Check critical production paths
  for (const check of criticalPaths) {
    if (!checkFile(check.path, check.forbiddenPatterns, check.description)) {
      allPassed = false;
    }
  }

  // Check Systems/Routines safety
  if (!checkSystemsRoutinesSafety()) {
    allPassed = false;
  }

  console.log('\n' + (allPassed ? '✅ All architecture checks passed' : '❌ Some architecture checks failed'));
  process.exit(allPassed ? 0 : 1);
}

main();
