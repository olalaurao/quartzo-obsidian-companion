from pathlib import Path

path = Path('scripts/architecture-check.mjs')
text = path.read_text(encoding='utf-8')
old = """function checkNoHardcodedQuickAddFolders() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  if (!fs.existsSync(shellPath)) {
    console.error('FAIL: Quartzo shell missing');
    return false;
  }
  const content = fs.readFileSync(shellPath, 'utf8');
  const forbidden = ['tasks/', 'notes/', 'journal/', 'reminders/'];
  const violations = forbidden.filter(value => content.includes(`'${value}`) || content.includes(`\"${value}`));
  if (violations.length > 0) {
    console.error(`FAIL: Quick Add contains hardcoded canonical folders: ${violations.join(', ')}`);
    return false;
  }
  if (!content.includes('resolveCreationFolder')) {
    console.error('FAIL: Quick Add does not consume shared Object Identification settings');
    return false;
  }
  console.log('PASS: Quick Add paths come from shared Object Identification');
  return true;
}
"""
new = """function checkNoHardcodedQuickAddFolders() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const creationPath = path.join(rootDir, 'src/core/object-creation.ts');
  if (!fs.existsSync(shellPath) || !fs.existsSync(creationPath)) {
    console.error('FAIL: Quartzo shell or canonical object-creation owner missing');
    return false;
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  const creation = fs.readFileSync(creationPath, 'utf8');
  const content = `${shell}\n${creation}`;
  const forbidden = ['tasks/', 'notes/', 'journal/', 'reminders/'];
  const violations = forbidden.filter(value => content.includes(`'${value}`) || content.includes(`\"${value}`));
  if (violations.length > 0) {
    console.error(`FAIL: Quick Add contains hardcoded canonical folders: ${violations.join(', ')}`);
    return false;
  }
  if (!creation.includes('resolveCreationFolder') || !shell.includes('buildQuickAddDocument')) {
    console.error('FAIL: Quick Add does not route through canonical shared Object Identification creation owner');
    return false;
  }
  console.log('PASS: Quick Add paths come from shared Object Identification');
  return true;
}
"""
if old not in text:
    raise RuntimeError('Architecture gate block not found')
path.write_text(text.replace(old, new), encoding='utf-8', newline='\n')
print('V1 UI architecture gate owner fixed')
