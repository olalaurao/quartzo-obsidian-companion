from pathlib import Path
p = Path('tests/sync/p0-regression.test.ts')
s = p.read_text(encoding='utf-8')
old = """      localOnly: [{ path: 'local-only.md', status: 'local_only', localHash: h('local'), remoteHash: null }],
      divergent: []
    };"""
new = """      localOnly: [{ path: 'local-only.md', status: 'local_only', localHash: h('local'), remoteHash: null }],
      divergent: [],
      ambiguous: []
    };"""
if old not in s:
    raise SystemExit('pairing summary fixture not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
