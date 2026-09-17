from pathlib import Path

for name in ['tests/vault/shared-settings.test.ts', 'tests/contracts/ui_shell.test.ts']:
    path = Path(name)
    text = path.read_text(encoding='utf-8')
    text = text.replace('markerValue: kind: task', 'markerValue: "kind: task"')
    text = text.replace('markerValue: kind: reminder', 'markerValue: "kind: reminder"')
    path.write_text(text, encoding='utf-8', newline='\n')

print('V1 UI repair YAML fixtures fixed')
