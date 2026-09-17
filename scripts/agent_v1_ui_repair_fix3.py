from pathlib import Path
import re

path = Path('scripts/architecture-check.mjs')
text = path.read_text(encoding='utf-8')
new = """function checkNoHardcodedQuickAddFolders() {
  const shellPath = path.join(rootDir, 'src/ui/shell/view.ts');
  const creationPath = path.join(rootDir, 'src/core/object-creation.ts');
  if (!fs.existsSync(shellPath) || !fs.existsSync(creationPath)) {
    console.error('FAIL: Quartzo shell or canonical object-creation owner missing');
    return false;
  }
  const shell = fs.readFileSync(shellPath, 'utf8');
  const creation = fs.readFileSync(creationPath, 'utf8');
  const content = `${shell}\\n${creation}`;
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
pattern = re.compile(r"function checkNoHardcodedQuickAddFolders\(\) \{[\s\S]*?\n\}\n(?=\nfunction main\(\))")
text, count = pattern.subn(new.rstrip('\n'), text, count=1)
if count != 1:
    raise RuntimeError('Architecture gate function not found')
path.write_text(text, encoding='utf-8', newline='\n')
print('V1 UI architecture gate owner fixed')
