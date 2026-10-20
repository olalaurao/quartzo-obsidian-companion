# Reading Integration — Companion status

Date: 2026-10-20, America/Sao_Paulo
Status: implementation in progress; canonical contract adoption verified, runtime and interoperability gates open
Authority: [pinned Reading Activity contract](../../contracts/quartzo/reading_activity/README.md), [local operational spec](../specs/drive-sync-operational.md), existing sync owners

## 2026-10-19 — Contract adoption checkpoint before owner integration

- The user authorized Quartzo PR65 after its required checks passed. [PR65](https://github.com/olalaurao/aplicativo/pull/65) merged into upstream main as `e7a661d4ed6d572cdbf722f4e697fea461005b69`. Its tree is identical to tested `2a2cd49b33637f939f521acfc1d7d15cf0d569b2`: Linux **2765 PASS / five skipped**, Windows **2745 PASS / 25 skipped**, with Analyze, Agent Contract Gate and Dial Focus also green. The previous Windows failure was a real deep-path enumeration defect and was corrected before merge; it is not reported as PASS.
- The exact-source normal Android main build passed in **811.5s**; 17 source fingerprints, clean checkout, package/version, kernel markers and archived APK were verified. APK SHA-256 is `8622cd51d549ef7a15e56abf3f493cb65337e1a8c615365daa60206ceb04b50e`. Receiver/diagnostic markers are absent and no installation occurred. Earlier Android v6 physical evidence remains bound to f2be1dba; this build adds no physical, cloud or ACK proof.
- Companion started from clean `efa53aa64d8c08277aa7e68dbd79e8e9a61229be`. Existing sync baseline: **270 PASS / one skipped**; typecheck, architecture and documentation baseline passed. Synthetic executions of the actual old coordinator reproduced Reading overwrite, removal, rename and wrong-digest conflict-repair behavior; ordinary mutable controls behaved as intended. These observations used owned synthetic files and in-memory adapters, not production files or a real Drive account.
- Only after upstream merge, `scripts/sync-contracts.mjs sync` adopted the merged commit and `verify` checked **51 files byte-for-byte** through GitHub. No local-source override or independently edited vendor file was used. The previous pin `08b0f18cf62fb626ecd35a212df226e540810de6` is an ancestor; existing contract versions were retained and the four Reading version entries were added.
- Clean dependency install passed (**300 packages, 58s**). The unchanged consumer's contract suite passed **367 tests / 23 files** (5.79s). This checkpoint does not claim that the newly pinned Reading semantics are already enforced by the Companion runtime; owner integration and its new regression tests follow separately.

## Open gates

### 2026-10-20 — Authorized merge and official main preflight

The user authorized PR86 merge after all final checks and official Release
Preflight on main for sandbox preparation. All six checks were revalidated on
`c09980e89c5b391d0c69be1f28872ef2f0f9d049`; [PR86](https://github.com/olalaurao/quartzo-obsidian-companion/pull/86)
merged at 05:20:10 UTC as **34d1244ec718cbd100f0f124ed76816dbde9008d**.
Its tree `a735fe91a1402c2781f660ffaa890557c114b8c7` matches the tested PR head
exactly. [Normal main CI 39374344480](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39374344480)
then passed Linux, Windows and macOS. Official
[Release Preflight 39374550229](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39374550229)
passed on the same exact SHA, including OAuth artifact injection, canonical
contracts, audit, typecheck/lint, architecture, production build, release
validation, clean-artifact smoke, packaging and upload. Main Linux/macOS and Linux preflight
full suites: **979 PASS / three skipped**; contracts **397 PASS**; sync
**365 PASS / three skipped**. Main Windows sync: **366 PASS / two skipped**.
Two skips are the optional cross-client exchanges; Unix additionally skips its
case-alias case. The separately executed Reading exchange remains its own proof.

A fresh local sandbox outside production vaults contains only the two synthetic
shards from the source-fingerprinted exchange and an ordinary text control. Both
shard filename digests were independently checked. The official artifact was
downloaded and its three assets independently matched the packaged SHA256SUMS;
manifest/styles also match the exact committed blobs. Staged bundle SHA-256 is
`12743ddb779a4bea9e923c5c7d1f3d0949189abfe982f8468881697a2dfdf702`
(1174875 bytes). It is present only in the new sandbox, disabled, with fresh Manual
and unpaired settings. No Obsidian session, OAuth pairing or live cloud test was
started. [Exact-main artifact evidence](main-preflight-2026-10-20.json) records
public build metadata/hashes and explicit false live/production/ACK fields;
embedded build credentials and account secrets are absent from that evidence.
The [live acceptance procedure](LIVE_SANDBOX_RUNBOOK.md) defines the exact-artifact,
manual test-target setup and required observations. No tag/release, production
installation, source cursor or Resource effect was authorized by this preparation.
The package version remains 1.0.43; its existing published tag is not moved/reused.

### 2026-10-20 — Build, hosted CI and cross-client exchange

Runtime checkpoint `e2b1664950262c8f9a354eb7f2cd97b38d2181d2` passed [PR CI 39369670535](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39369670535) and [push CI 39369667299](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39369667299) on Linux, Windows and macOS. Linux/macOS full suites: **979 PASS / two skipped**; Windows sync: **366 PASS / one skipped**; Linux/macOS sync: **365 PASS / two skipped**. Both Unix contract runs have **397 PASS**. Official contract verification, audit, docs, typecheck, lint/architecture where configured, build, smoke and packaging also passed. The platform-dependent case-alias case and opt-in exchange explain the different skips. [PR86](https://github.com/olalaurao/quartzo-obsidian-companion/pull/86) was draft at this checkpoint; the authorized merge is recorded above.

The same runtime built in a dedicated detached checkout. [Artifact evidence](isolated-build-e2b1664-2026-10-20.json) records bundle SHA-256 `d0a33e73b94bb9e5bc57acfbdd31bbeea3c0da81ee8f2e2a6b6bd43b38b722ec` (1174768 bytes), non-release validation, clean-artifact smoke and packaging. OAuth build credentials were unset; this is not release preflight or a usable installed OAuth release. No installation/publication occurred.

Optional `npm run test:reading:exchange` now exercises four actual-owner stages across both sibling checkouts, with isolated local files/SQLite and synthetic remote byte transport. Exact clean test heads **Companion 084c279ea9cb72c996956c1daa630df2de2536c8 / Quartzo db89ac5544704104c992facc6082548895f489a0 PASS**. The [source-fingerprinted report](cross-client-exchange-2026-10-20.json) records unchanged inputs and all four observations: canonical Dart shard creation, Companion pull/restart/local repair and remote-absence preservation, opaque future-schema publication, Quartzo pull/restart/repair and final Companion identity/byte verification. All real-cloud/Obsidian/power-loss/ACK fields remain false. First runner attempts failed on Windows argument quoting and then a mismatched selector; they ran no cases and remain failed private reports. Final exact-source replay passed after correcting both. The new test/runner adds no runtime owner or contract/wire change. Scoped Dart analysis, Companion typecheck, lint, architecture and docs pass; hosted checks must run on the new test/documentation head too.

### 2026-10-20 — Explicit original-byte repair checkpoint

The next owner change implements remote recovery through `GoogleDriveAdapter.repairReadingFile`, called only by explicit conflict resolution. It snapshots caller fields/bytes, requires the original filename digest and reviewed remote hash, performs its own bounded current-byte/version read, verifies singular rooted identity, conditionally writes with that exact ETag, then independently reads back bytes and rechecks identity/duplicates before success. Generic mutation and purge guards remain closed. Already-restored bytes are idempotent; changed review evidence, wrong digest, incomplete/duplicate identity, target changes, oversized media and failed postconditions retain the conflict. A concurrent read cannot replace this operation's ETag.

The coordinator retires only the deletion/rename intents captured by the completed review. Newer same-path deletion intents survive. Reviewing a relocation restores the original path while preserving the relocated copy. Existing local inventory, uploads and expected Reading downloads enforce the pinned **524288-byte** shard limit; Drive metadata, HTTP response limits and returned lengths are checked. No raw-event parser, new persistence owner, production writer or canonical ACK is added.

Validation: **seven new actual-coordinator tests PASS**, including remote/local original-byte repair, changed remote evidence, lost response followed by convergence, reviewed deletion retirement, newer deletion preservation and relocation recovery. **16 new SDK cases PASS**, including operation-bound ETag/cache races, caller mutation, exact limit and failure postconditions. Integrated sync suite: **366 PASS / one skipped** (66.40s). Final full suite after the HTTP-bound assertion: **980 PASS / one skipped**, 87 files (68.95s). Typecheck, lint, architecture, documentation and whitespace pass. The canonical production dependency audit reports **zero vulnerabilities** with local npm 11.11.0; CI retains its official npm 11.19.1 pin. Build and hosted CI still need the committed final source; these are synthetic SDK/owned filesystem tests, not real Drive/Obsidian, directory/power-loss or source ACK proof.

### 2026-10-20 — Guarded owner checkpoint

Owner candidate is integrated after adoption in the existing engine, coordinator and Drive adapter. It adds the pinned shared executor, actual-coordinator lifecycle/repair/alias/collision regressions and synthetic SDK file-ID/ancestry/version/retarget cases. `test:sync` includes these cases on every CI platform. Initial integrated sync suite: **342 PASS / one skipped**, including 30 shared cases and actual Windows filesystem aliases/collision cases. A further SDK regression reproduced an accepted rename reply after retarget; adding the missing post-await checks corrected it. The corrected SDK suite has **23 PASS**, including the five existing conditional-write cases.

The first full run had **956 PASS / one failed / one skipped** because an unrelated notification fixture used a September timestamp against the real October clock and was correctly expired by its 30-day retention rule. Only the test clock/cleanup guards changed; the same fixture now proves both restart retention and later expiry. Corrected clock/SDK subset: **25 PASS**. Final full suite: **957 PASS / one skipped**, 87 files (75.05s), plus typecheck, lint, architecture, documentation and whitespace PASS. No physical cloud, production Obsidian or cursor proof is inferred.

The generic remote mutation guard intentionally remains closed for Reading at this checkpoint. Next implement explicit original-byte remote repair through the same adapter with an operation-bound current-byte/version observation, identity/duplicate checks and post-write verification. This is required recovery work, not a substitute for it. Build/hosted CI and real interoperability still need validation of the final owner source.

G03 has a guarded immutable lifecycle/identity and explicit repair implementation in the existing owners, now merged with committed-source build and hosted CI evidence above. Real Drive/Companion interoperability and supported-filesystem acceptance remain open. Pure or mocked tests cannot establish global exclusion, all-writer cooperation, directory/power-loss durability or canonical source acknowledgements. Remote history purge requires a separate reviewed contract.

Production Kindle extraction/outbox, deployed authenticated ingress, cursor advancement, Resource promotion/status effects, automation, analytics/UI, Readwise migration and release/rollback remain outside this checkpoint. No production installation or feature activation is implied by contract adoption.
