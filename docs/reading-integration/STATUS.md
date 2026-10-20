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

### 2026-10-20 — Guarded owner checkpoint

Owner candidate is integrated after adoption in the existing engine, coordinator and Drive adapter. It adds the pinned shared executor, actual-coordinator lifecycle/repair/alias/collision regressions and synthetic SDK file-ID/ancestry/version/retarget cases. `test:sync` includes these cases on every CI platform. Initial integrated sync suite: **342 PASS / one skipped**, including 30 shared cases and actual Windows filesystem aliases/collision cases. A further SDK regression reproduced an accepted rename reply after retarget; adding the missing post-await checks corrected it. The corrected SDK suite has **23 PASS**, including the five existing conditional-write cases.

The first full run had **956 PASS / one failed / one skipped** because an unrelated notification fixture used a September timestamp against the real October clock and was correctly expired by its 30-day retention rule. Only the test clock/cleanup guards changed; the same fixture now proves both restart retention and later expiry. Corrected clock/SDK subset: **25 PASS**. Final full suite: **957 PASS / one skipped**, 87 files (75.05s), plus typecheck, lint, architecture, documentation and whitespace PASS. No physical cloud, production Obsidian or cursor proof is inferred.

The generic remote mutation guard intentionally remains closed for Reading at this checkpoint. Next implement explicit original-byte remote repair through the same adapter with an operation-bound current-byte/version observation, identity/duplicate checks and post-write verification. This is required recovery work, not a substitute for it. Build/hosted CI and real interoperability still need validation of the final owner source.

G03 still needs the existing coordinator/adapter to enforce immutable lifecycle and exact file identity, followed by real Drive/Companion interoperability and supported-filesystem evidence. Pure or mocked tests cannot establish global exclusion, all-writer cooperation, directory/power-loss durability or canonical source acknowledgements. Remote history purge requires a separate reviewed contract.

Production Kindle extraction/outbox, deployed authenticated ingress, cursor advancement, Resource promotion/status effects, automation, analytics/UI, Readwise migration and release/rollback remain outside this checkpoint. No production installation or feature activation is implied by contract adoption.
