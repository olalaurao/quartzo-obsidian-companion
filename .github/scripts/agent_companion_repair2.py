from pathlib import Path
import json

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['dependencies']['google-auth-library'] = '10.5.0'
pkg_path.write_text(json.dumps(pkg, indent=2) + '\n', encoding='utf-8')

types_path = Path('src/ui/types.ts')
types = types_path.read_text(encoding='utf-8')
needle = "    driveAdapter: GoogleDriveAdapter | null;\n"
replacement = needle + "    authState: 'disconnected' | 'authenticating' | 'authenticated_unpaired' | 'paired' | 'authentication_required';\n"
if needle not in types:
    raise SystemExit('missing ViewContext driveAdapter field')
types = types.replace(needle, replacement, 1)
types_path.write_text(types, encoding='utf-8')
