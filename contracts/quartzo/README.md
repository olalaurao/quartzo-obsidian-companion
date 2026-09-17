# Quartzo Obsidian Companion Contracts

This folder contains the canonical language-neutral contracts for the future Quartzo Obsidian Companion.

## Documents

- `QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md` - parent product and architecture contract.
- `QUARTZO_SYNC_PROTOCOL_V1.md` - normative sync protocol for Dart and TypeScript clients.
- `QUARTZO_VAULT_INTEROP_CONTRACT_V1.md` - persisted vault/object interoperability contract.
- `QUARTZO_COMPANION_UI_SPEC_V1.md` - V1 Obsidian-hosted UI behavior.
- `P0_COMPLIANCE_MATRIX.md` - requirement-to-code-to-test implementation index.

## Versioning

Contracts use semantic versions. Clients may read compatible minor versions, but a client that sees a higher major version than it supports must block unsafe mutations instead of guessing.

## Precedence

```text
current request
-> applicable spec
-> guidelines.md
-> agents.md
-> existing architecture and patterns
```

Child contracts own their detailed domain. The parent contract links the domains together and should not duplicate every rule.
