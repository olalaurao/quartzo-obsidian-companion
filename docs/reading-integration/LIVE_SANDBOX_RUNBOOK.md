# Reading immutable sync — live sandbox acceptance

Status: prepared procedure; no live Drive/Obsidian PASS is implied.

Authority: [operational sync spec](../specs/drive-sync-operational.md), pinned
[Reading contract](../../contracts/quartzo/reading_activity/README.md) and the
[official build procedure](../BETA_RELEASE_RUNBOOK.md). Results belong in
[STATUS](STATUS.md) with exact source, artifact and target observations.

## Preparation

1. Record the merged main SHA and matching successful normal CI. Run the existing
   Release Preflight on that main; require the same SHA and every step successful.
2. Download its `quartzo-companion-<sha>` artifact into a fresh owned diagnostics
   directory. Check the three asset hashes against `SHA256SUMS.txt`, manifest ID,
   desktop requirement and minimum Obsidian version. Keep the injected OAuth build
   credentials out of diagnostics, source control and copied console excerpts.
3. Create a new sandbox vault outside production vaults and Drive Desktop roots.
   Stage only those assets in its own plugin directory. Use fresh manual,
   unpaired settings; do not copy another vault's settings, sync state or tokens.
   Keep the plugin disabled until opening this exact vault for acceptance.
4. Seed only synthetic files with independently verified filename digests. The
   source-fingerprinted [actual-owner exchange](cross-client-exchange-2026-10-20.json)
   provides one canonical Dart-created shard and one opaque future-schema shard.
   Include an ordinary mutable text control. Preserve original bytes separately.

## Human setup and observations

Open the new vault in a supported Obsidian Desktop, enable its staged Companion
and confirm the exact asset SHA independently of the unchanged package version.
For cloud acceptance, use the canonical OAuth UI and explicitly select a new
dedicated test folder. Recheck that target before accepting pairing; leave Manual
mode selected. Do not select a production vault or import production sync state.
No account identifiers, folder IDs, callback URLs or tokens belong in public proof.

Record each step's actual result before continuing:

| Exercise | Required observation |
| --- | --- |
| Initial manual pairing and sync | Unique rooted remote identity, exact shard bytes and filename SHA-256; ordinary control transported. |
| Quiet sync, plugin restart, another sync | Same bytes/identity; no duplicate shard or upload inferred solely from timestamps. |
| Original shard absent remotely after baseline | Persistent review/conflict and retained original evidence; no history purge or silent baseline removal. |
| Explicit original-byte restoration | Review binds the current corrupt hash/version, original filename digest and unique rooted identity; post-write bytes independently match. |
| Remote changes after review | Operation rejects stale evidence, retains conflict and preserves concurrent bytes. |
| Local deletion/rename and restart | Pending intent/conflict survives; generic mutation cannot erase the original Reading fact. |
| Opaque future-schema shard | Transport preserves exact bytes without semantic ingestion or Resource effects. |
| Ordinary control changed | Existing mutable sync continues to work outside the Reading namespace. |
| Network interruption/lost reply | Error remains observable; retry independently verifies convergence without duplicate facts. |

Real Quartzo-to-Drive interoperability additionally requires the exact tested
Quartzo build operating on an isolated test target. A Companion-only run, synthetic
remote, matching mock report or local filesystem test cannot satisfy it. Record
which client actually performed each operation and which steps remain unrun.

Stop after an unexpected result and preserve owned fixtures/evidence. Closing the
sandbox must not modify production vaults or remove immutable history. Keep
cleanup limited to the exact disposable targets and separately review any remote
cleanup. This exercise grants no canonical ACK, source-cursor authority,
production Statistics extraction, Resource promotion or power-loss guarantee.
