# Object Organization Contract V1

## Purpose

This contract defines the canonical, language-neutral specification for Object Organization operations shared between Quartzo (Dart) and the Quartzo Obsidian Companion (TypeScript).

## Files

| File | Description |
|------|-------------|
| `contract.json` | Full operation semantics, scope model, revision/transition protocol, issues projection, sync rules |
| `vectors.json` | Test vectors for reclassify, scope, bulk_mutate, revision/transition, merge, anti-resurrection, sync interactions |

## Key Invariants

### Scope is not a rule (§3.3, §4)

A folder or file selection is a **scope** for an operation — it never becomes an Object Identification rule. The copy `"This changes these objects. It does not change the Resource identification rule."` must appear whenever an object-level operation is initiated from a folder.

### Reclassify is not blindly setting `type` (§20)

Reclassify makes an object satisfy a TypeSignature canonically:
- Property-based: apply property key/value
- Tag-based: apply/remove canonical tag
- Folder-based: move to correct folder

It never just writes `frontmatter.type = targetType`.

### Revision/Transition protocol (§9, §10, §11)

`object_identification.revision` is a monotonic integer — not clock-based. During structural migration:
- Both old and new signatures are recognized as equivalent
- `transition` state is cleared only when `revision N+1` commits
- Content transport must complete before revision commits cross-client

### Merge is ID-based and explicit (§58, §61)

- Survivor is explicitly chosen by the user — never automatic `latest updatedAt`
- Target type is an independent choice from survivor identity
- Cross-type merge requires explicit target type
- Losers retire through canonical delete lifecycle only

### No second store (§1, §128)

No `ObjectOrganizationDatabase`, `MergeSync`, `ReclassifySync`, or parallel index. All queries go through the existing `VaultIndex` / `object-query`. All sync goes through the existing coordinator.

## Vendoring

Companion must vendor this contract and run CI gates that fail when:
- Contract version in `contract_manifest.json` diverges from vendored content
- Architecture gates detect direct Markdown writes in UI, Drive API in settings sync, second object index, `ObjectOrganizationSync*`, direct `vault.delete()` in merge UI, or folder selection mutating TypeSignature without explicit Rule action

## Version history

| Version | Changes |
|---------|---------|
| 1.0.0   | Initial Object Organization V1 contract |
