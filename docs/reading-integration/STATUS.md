# Reading Integration — Companion status

## 2026-10-23 — Full index rebuild preserves current observations (local validation completed)

Previous goal turn made concrete progress: PR97 merged as2a05496860495dad1abc3f911f75d10068f4a39b
with six exact719afae checks and main CI40005201773/all three platforms successful.
Devices remain unavailable; KOReader/source-generation/physical Gate4 stay OPEN.

The actual full initializeVaultIndex method was added to the existing TS-AST
callback harness with controlled synthetic SDK reads and the actual parser/index.
Five baseline scenarios on accepted2a05496 exposed stale full publication after
incremental edits, deletion, file-object replacement, new roster entries and
engine replacement. A new retry-bound case also failed because no retry existed.
The first settings-change fixture failed for its own missing frontmatter closing
newline, not a production regression; the corrected case now exercises settings
capture/revalidation. Initial narrow Object.assign fixture typing was corrected;
no production criterion or source parser was changed for those harness errors.

The same owner now revalidates engine/index, settings, observed file roster,
TFile identity and metadata before replacing its full projection. Relevant event
dispatch invalidates pending observations via a transient counter; it is not a
source/database-generation ID. Up to three attempts handle observed churn; then
failure preserves the prior usable index instead of clearing it. The existing
shared-settings owner backs a manual Reload vault index command, guarded by
workspace readiness/in-flight state. It reports partial/unpublished/error results
separately and never prints raw unreadable-file error paths. No new service,
index/store, queue, schema, contract/vendor lock, file mutation or sync policy.

Final local suite passed1081 tests/two existing explicit skips across93 files
(70.04s), including29 actual-method/callback cases. The earlier70 focused cases
also passed. Typecheck, lint, architecture/docs, build, release validation,
clean-artifact smoke, packaging and production audit passed (zero vulnerabilities).
The architecture guard was updated for the same reload owner's returned read
count and now checks create/modify/delete/rename routing individually through
its fixed-error helper, preserving load→assign→rebuild→refresh ordering.

Branch `fix/vault-index-rebuild-races` starts at accepted2a05496. The associated
PR records the exact final source SHA, platform CI and merge. All final checks
must pass before the standing authorized merge. These are host method executions with SDK models,
not the whole plugin, actual Obsidian rendering/readiness or complete-vault/writer
proof. No Reader link, promotion, Reading ingestion/effect, device operation,
account API/token/vault access, release or installation is enabled by this work.

## 2026-10-23 — Concurrent index-read correction (local validation completed)

Previous goal turn made concrete progress: Companion PR96 merged as52ce189 after
all six exact0890815 checks; main CI40002464078 also passed all three platforms.
KOReader PR5/source336a7a8 remains draft for source enrollment and physical Gate4.
The user cannot operate devices; no install, account/vault access or timed session.

Actual existing registerVaultEvents callbacks were executed from their TypeScript
AST with controlled synthetic Vault/TFile/read dependencies and the actual index/
shared-settings parser owners. Eleven regressions failed on accepted52ce189:
concurrent creates lost an entry/collision, delayed modification restored another
file's deletion, older reads won, rename success/failure replaced intervening
changes, and replaced-engine/file scope accepted stale work. These are real host
callback executions with SDK models, not full plugin/Obsidian/native evidence.

The same VaultIndexEngine now applies completed incremental changes against its
CURRENT snapshot synchronously. Current main callbacks and organization index
updates use that method instead of a pre-await snapshot. Event-local weak markers
and current engine/path/TFile identity reject stale completions without another
store, queue, parser, service or persisted generation. Ordinary rename immediately
retires only the old in-memory path; failed/superseded reads cannot publish it
again. Full initial/shared-settings rebuilds retain their existing implementation;
this does not certify their global consistency or complete-vault authority.

Initial34 focused index/collision tests passed. The final full suite, including
13 actual-callback cases and the missing-index case, passed1065 tests/two existing
explicit skips across93 files (67.68s). Typecheck, lint, architecture/docs, build,
release validation, clean-artifact smoke, packaging and production audit passed
(zero vulnerabilities). One earlier full run failed the existing remote-ID edit
case:1064 passed/two skipped/one failed. Nine matching sync cases then passed in
isolation and the unchanged full suite passed on repetition; cause is unconfirmed,
with the original failure retained rather than relabeled or its criteria changed.

Branch `fix/vault-index-read-races` starts at accepted52ce1896a2c4886471e6f50ddff476431b31b271.
The PR associated with this branch records the exact final source SHA, platform
CI and merge; all final checks must pass before the standing authorized merge.
Device/Obsidian proof and remaining Reading gates stay OPEN. No Markdown/file mutation, transport/sync
policy, shared contract/vendor lock, source enrollment or Reading effect changed.

## 2026-10-23 — Conflicting object IDs remain reviewable (host accepted)

Exact24d490b41dc5bc93dc0d3d47a2882a48d4062ece passed all six Linux/Windows/macOS
checks across [PR CI40001517712](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/40001517712)
and [push CI40001458992](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/40001458992).
PR CI Linux/macOS each passed1050 tests/three explicit skips,399 contracts and
393 sync/two platform skips plus the CI-only bounded audit skip; Windows sync
passed394/two skips. Follow-up documentation commits require their own exact-head
checks; [PR96](https://github.com/olalaurao/quartzo-obsidian-companion/pull/96) records
the final acceptance/merge. No release, installation or physical acceptance.

The previous goal turn made concrete PhaseD recovery-UI progress: KOReader PR5
exact336a7a8 passed400 cases/no skips. Devices remain unavailable; physical Gate4,
source generation and later ingestion/effects stay OPEN. The complete Reader
catalog was already observed through the actual Dart owner (1423 normalized
external documents,28 successful responses), so this block did not repeat API calls.

Review found a separate identity gap in Companion's canonical index: two parsed
files with the same non-empty ID selected the last encountered file in `objects`,
while the existing duplicate-Issues calculation could never see both. Five new
synthetic baseline regressions failed against accepted4170fff. This is not a
claim that the user's actual exports contain colliding non-empty IDs.

The same index now retains only ambiguous candidates in reconstructible
`identityConflicts` metadata and excludes their ID from ordinary lookup/query/
pickers. Files and candidate projections are preserved without new IDs, another
index/store, parser, persisted schema or Markdown rewrite. The existing query
owner exposes review candidates to Issues and current explicit merge UI only.
Add/modify/delete/invalidation retain old snapshots and recover the unique
remaining candidate. Ignored/system paths remain excluded from ordinary Issues;
that exclusion does not grant global uniqueness or permit an arbitrary survivor.

Focused43 cases passed, including seven new collision/re-identification cases,
existing unidentified files and Issues/query owner behavior. Full local suite:
1051 PASS/two existing explicit skips over92 files (62.44s). Typecheck, lint,
architecture/docs, build, release validation, clean-artifact smoke, packaging and
production audit passed (zero vulnerabilities). The first full suite passed1050
and failed one old source-shape assertion requiring duplicate review to iterate
raw files. That assertion now enforces the existing query owner's review path
and rejects the old unique-lookup filter; production criteria are unchanged.
Exact-source CI results are recorded above; no host result is native Obsidian
acceptance. This local safety correction grants no Reader link,
complete-vault proof, automatic promotion/status effect or physical acceptance.
No device, Obsidian, source vault, token, API, release or installation was touched.

## 2026-10-23 — Host fixes accepted; authenticated namespace sample observed

Upstream [PR86](https://github.com/olalaurao/aplicativo/pull/86) merged as `df9b6b0b442fcbba81b8f48313ec1cfe58b5f225` after all five exact-head checks passed (hosted 2911 PASS/eight skips; Windows 2882 PASS/37 skips). Its tree equals tested source `81a616fa1fed2a15c4d2856579409ca4bc5f81e0`. Dependent [Companion PR94](https://github.com/olalaurao/quartzo-obsidian-companion/pull/94) then merged as `1f04c9b49bfefe0cde3f343e828086e5eceac060` after all six checks passed; its tree equals tested `cc70cf21f430174c8208dc68373e8bcb2871fd18`. Local Companion validation passed 1044 tests/two skips and 399 contract tests, plus typecheck, lint, docs, architecture, build, artifact validation/smoke/packaging and production dependency audit (zero reported vulnerabilities). The earlier candidate entries below remain historical observations.

A separate [sanitized live API observation](readwise-authenticated-observation-2026-10-23.json) verifies the 120 distinct numeric book IDs in the selected local export scope against authenticated Readwise Books LIST. The local writer map has 145 rows, not 145 distinct books: 22 IDs have multiple path entries and 25 map paths are not in the selected snapshot. The 120 current marked files have distinct IDs. Missing snapshot entries do not authorize cleanup or determine the exclusive owner.

For three sampled Reader-source books, Readwise Highlight EXPORT returned an `external_id` that exact Reader Document LIST queries resolved to the same document ID. This uses the separate namespaces and service-provided bridge, never title/URL matching or interpreting `book_id` as a Reader ID. The [Readwise API](https://readwise.io/api_deets) describes the export source reference; the [Reader API](https://readwise.io/reader_api) describes exact-ID lookup. Eight total GETs were made across the two observations, with no HTTP mutation methods, source/vault writes, retained credential or persisted API bodies. Source configuration and original/frozen input hashes remained unchanged.

This is finite point-in-time account/API evidence. Public aggregates cannot independently replay the private payloads. Stable account binding, whole-vault completeness, exclusive export ownership, local Reader artifact provenance, native Obsidian export/reexport, safe template migration and physical/release acceptance remain unproven. No canonical binding, automatic Resource promotion, status change, habit or KPI effect is enabled. Current physical Gate4/source-generation and the complete Reading release DoD remain open.

## 2026-10-23 — Bare prose is not a Tag marker (host candidate)

The private actual-file replay exposed a second concrete mismatch after the missing-ID correction: two files parsed as Ideas only because a body word equaled a tag signature configured without `#`. Both also matched Resource; no corresponding hashtag/frontmatter tag existed. The existing migration owner in both clients already requires a hashtag in body and emits it for a shorthand configured name.

This candidate removes the bare-word match in the existing shared-settings parser and normalizes ordinary creation to the established hashtag syntax. Upstream PR86 supplies explicit migration vectors and fixes the corresponding ordinary creation helper; dependency acceptance and the normal vendor/lock workflow remain required before merging this candidate. No type priority, alias, template, original Markdown, persisted status, automatic classification or promotion policy changes.

Before-fix Companion regressions failed twice; the initial corrected focused suite passed 41 cases before vendoring the new vectors and adding a full Quick Add-to-parser regression. A private corrected replay parses 101 Resources with 20 YAML failures; all 121 files remain available for explicit review with unchanged hashes. These are parser observations only. Actual export/reexport, native review and ownership/migration acceptance remain open.

## 2026-10-23 — ID-less exports remain available for explicit review

A private, frozen local copy of 121 actual Readwise exports reproduced a canonical index defect: 101 files parsed (99 Resources and two Ideas under the copied shared settings), all without IDs, but only one survived in `objects`. Reversing input order selected a different file. Twenty other files failed YAML parsing. These are file/parser observations, not authenticated export ownership, Reader identity or successful reexport evidence.

The existing `VaultIndexEngine` now retains every file in `files` and admits only non-empty string identities to `objects`. The existing Issues projection exposes unidentified files by path for Open Markdown and explicit Organization review. No fallback UUID, path-derived object identity, second index, template change or automatic source rewrite is introduced. Incremental ID removal/replacement removes the old identity at that path; ordinary safe editing rejects an empty expected identity.

Focused tests: 33 PASS, including canonical shared-settings parsing, index, query, Issues and scope resolution on synthetic documents, invalid identity values, incremental identity removal and mutation rejection. A private replay accounts for all 121 exports as unidentified review subjects in both input orders, with snapshot hashes unchanged. Full-suite/CI validation of the final candidate is recorded with its PR; native Obsidian review, actual export/reexport and production migration remain open. Conflicting non-empty IDs are outside this narrowly scoped correction.

## 2026-10-20 — Expired credential during fresh peer recovery

An actual isolated second adapter/coordinator using the official sandbox artifact
at main `8c515898ab919a4b9e214ff84563cd36c6d4c243` failed its initial recovery
with a token/credential error before downloading files. The peer operation ended
with its lock released; all six original fixture hashes remained unchanged.
[Sanitized failed-attempt evidence](live-peer-auth-failure-2026-10-20.json)
preserves that failure, not a successful cloud race or ACK.

Focused canonical-folder lookup tests then reproduced a stale SDK client after
refresh: both first-page and later-page expiry cases failed before the fix.
`GoogleDriveAdapter.listNamedChildren` now resolves its existing SDK client inside
the existing retry callback. A refreshed token therefore retries the same page
with the refreshed client; completed pages are retained. Eight focused tests pass,
including an unsuccessful refresh that stops after two requests without creating
a folder. Conditional mutation/target guards and upstream contracts are unchanged.
Local validation also passed typecheck, lint, build, architecture/docs gates and
the complete suite: **1026 PASS / two explicit skips** across 90 files. The full
suite contains the focused regression cases; no hosted CI result is assumed.
This source has not been installed or physically rerun in the sandbox; official
merge/preflight/asset verification and subsequent expiry/race acceptance remain open.

A separate explicit retry on the unchanged official 8c515898 artifact, after
renewal through the existing plugin OAuth owner, recovered all six files into
the independent adapter/coordinator's isolated local root. Both clients ended
synced with zero pending/conflicts/errors; independent host hashing matched all
six fixtures and confirmed the originals. [That narrow recovery observation](live-peer-recovery-after-refresh-2026-10-20.json)
retains `expiredCredentialRecoveryProven=false`, `concurrentRaceProven=false`
and `canonicalAck=false`. It does not relabel the first failure or prove this
new source's automatic refresh. Peer state stays outside the production vault.

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

### 2026-10-20 — Explicit adoption review and truthful pending feedback candidate

Binary media correction [PR89](https://github.com/olalaurao/quartzo-obsidian-companion/pull/89)
at **a0a7c68c4272fa8683e550921b5655273450651d** passed all six final checks:
[PR CI 39386360941](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39386360941)
and [push CI 39386355001](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39386355001),
Linux/Windows/macOS. User authorization for that specific merge and official
exact-main preflight is pending; the running sandbox still uses official 5ba99fd.
This follow-up is based on that tested correction and has not been installed.

The actual Sync Center now shows pending paths separately from reasons, derives
post-sync feedback from a fresh coordinator snapshot, and no longer equates an
empty conflict list with all files synchronized. Review adoption displays one
path and target before Adopt file invokes the existing plugin/coordinator. A
changed target, disconnected/offline state or active operation cannot authorize
another adoption. A successful, blocked or failed result remains visible and
copyable; the plugin no longer swallows errors or announces adoption success
when the coordinator may instead have preserved a divergence.

The same coordinator's adoption operation now holds the existing mutex and
reports real progress/checkpoints, rejects unsupported local identities and
Reading bytes, revalidates local bytes/target around awaits, and independently
hashes an existing remote even when its metadata claims equality. Different
copies remain conflicts. A null-baseline tracked ID stays pending after restart,
so a conflict-artifact failure cannot become a false synced state or prevent
explicit retry. Pairing cannot enter while that canonical sync lock is held.
No persisted UI state, parallel owner, production ingestion, cursor or ACK was
added. Nine actual-render/plugin-handler tests and eleven new actual-coordinator
cases cover review/confirmation/failure, retarget, canonical locking, byte/hash
spoofing, restart after conflict-artifact failure, cancellation and oversized
Reading rejection before body reads. The first full run rejected three legacy
fixtures that adopted without configuring a paired target; their setup now
selects the actual synthetic adapter root, while a dedicated negative test proves
that unpaired adoption stays blocked. The corrected full suite passed **1022
tests / two opt-in skips** (90 files, 76.88s). A later pre-read size guard, final
UI report/notice adjustments and the added oversized case passed in the final
**55-case scoped suite**; other cases were excluded only by that focused selector.
Typecheck, full lint, architecture, docs and whitespace pass. Exact committed
**e4d139ecdf233342da2626f8b95e87b9bc70224b** passed production build,
non-release validation and clean-artifact smoke. The
[build observation](adoption-review-build-2026-10-20.json) records bundle SHA-256
`b4d85fe4c1903ee2a10138d1c64ec179badf1a780972740d35d225359e6b3271`
(1179835 bytes). Only generated tracked `main.js` changed; the output was
archived and that file restored, leaving the source checkout clean. No local
candidate was installed and no tag/release changed. Final-head hosted checks,
merge authorization and official exact-main artifact/live UI acceptance remain
separate requirements.

Candidate [PR90](https://github.com/olalaurao/quartzo-obsidian-companion/pull/90)
at **a66915be2a0cac92e84c03008b4e90c3dab29ba9** subsequently passed all six
final Linux/Windows/macOS checks in
[PR CI 39389274003](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39389274003)
and [push CI 39388663625](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39388663625).
Linux/macOS full: **1022 PASS / three skips**; contracts: **397 PASS**; sync:
**390 PASS / three skips**. Windows sync: **391 PASS / two skips**. All fourteen
real-SDK media cases remain part of every sync run. PR89 transport inputs are
byte-identical in this dependent follow-up. The user has been asked separately
to authorize the PR89/PR90 merges and final official preflight for this sandbox;
neither approval nor a new installed-artifact result is assumed. The following
documentation-only checkpoint does not change these tested runtime inputs.

### 2026-10-20 — Live Obsidian/Drive rejected: binary upload omitted media

The user opened and paired the isolated corrected-main sandbox using official
source **5ba99fd02c87df072103390a377f611f7f452ff4** and confirmed setup. Native
inspection observed **Obsidian 1.14.4**, Manual preserved and the new dedicated
test vault paired. Three owned synthetic fixtures were seeded only after the
empty pairing. Actual Sync now reported three `adoption_required` items and zero
synced files. The Sync Center omitted their paths, offered no adoption action,
and incorrectly claimed no follow-up/all files in sync; those UI recovery gaps
remain open and are not a successful user flow.

Under exact sandbox and fixture-hash guards, DevTools invoked the existing
coordinator's explicit adoption operation for those three files, then the real
Drive adapter downloaded their bodies. All downloads were empty. An independent
Drive v2 metadata observation confirmed all three stored sizes **0** and MD5
`d41d8cd98f00b204e9800998ecf8427e`, while public hash properties still advertised
the original fixture digests. [Sanitized failure evidence](live-drive-media-failure-2026-10-20.json)
contains no account, folder or remote file IDs, credentials or personal content.
No production content was touched and no cloud/ACK gate passed.

The installed SDK's browser multipart branch includes only string parts and
silently omits Buffer media in the renderer; its Node branch instead expects a
stream. Four initial real-SDK HTTP-boundary regressions failed. The adapter now
supplies a byte-preserving multipart body through that same SDK/OAuth pipeline
for all media writes, retaining metadata atomicity, finite deadlines and exact
If-Match. Create requires independent unique-path/byte verification; mutable
update independently downloads and hashes the written bytes before success.
Existing explicit Reading repair retains its own post-write proof. Fourteen
real-SDK cases pass in Node/renderer conditions, including non-UTF8, legitimate
empty content, false-success dropped bytes, lost create reply and stale CAS.
The full suite passed **999 tests / two opt-in skips** (89 files, 79.71s) with
the first ten SDK cases; four added loss/CAS cases then passed in the final
**53-test adapter subset**, including all fourteen real-SDK cases. Typecheck,
scoped lint, architecture, documentation and whitespace pass. The first upstream
verification attempt lacked authentication and failed HTTP 404; the canonical
authenticated retry verified all **51 pinned contract files byte-for-byte**.
Exact committed source **e53e501a280f31084748bef42f1160c32289f3be** passed
production build, non-release validation and clean-artifact smoke.
[Build observation](binary-media-build-2026-10-20.json) records bundle SHA-256
`920395ad695c8cff4bcb4fa3ed63b7012cb313abb2251276557aa19f816b74f3`
(1175174 bytes). Only generated tracked `main.js` changed; it was archived and
restored, with all build inputs and the checkout clean. No OAuth release proof,
installation or tag change is implied. Final-head hosted CI and a new official
exact-main artifact test still follow.
Existing corrupt sandbox copies must be preserved
and repaired through the reviewed original-byte owner; neither metadata nor
local baselines may be manually rewritten to manufacture convergence.

### 2026-10-20 — Preserve Manual mode before live sandbox pairing

PR86 merged with user authorization as `34d1244ec718cbd100f0f124ed76816dbde9008d`,
tree-identical to tested c09980e. Normal main CI and official
[Release Preflight 39374550229](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39374550229)
passed on that exact commit. Its official artifact was checksummed and staged in
a new synthetic local vault, disabled, Manual and unpaired. The source-bound
artifact metadata and live acceptance procedure are in documentation-only
[PR87](https://github.com/olalaurao/quartzo-obsidian-companion/pull/87), whose final
Linux/Windows/macOS checks passed at cc66822. Neither live pairing nor production
installation occurred; the existing 1.0.43 tag was not changed.

Inspection before live pairing found all three existing completion paths silently
switching Manual to Automatic, including a duplicated assignment in divergence
resolution. Nine tests invoke the actual plugin handlers with mocked platform,
DOM and coordinator boundaries, checking successful Manual/Automatic completion,
saved preference, actual polling timers and failed pairing. Before the fix,
**three Manual regressions failed / six controls passed**. Removing those
assignments preserves the current user preference; pairing still applies only
its explicit reviewed operation. No new state/transport/mutation owner is added.

After correction: **27 targeted tests PASS**; full suite **989 PASS / two opt-in
exchange skips**, 88 files (61.16s). Typecheck, lint, architecture, documentation
and whitespace checks pass. Exact committed source
**b97d9c609a673a7bc304fb95811a09ba4e057cb1** also passed production build,
non-release validation, clean-artifact smoke and all nine handler cases again.
[Build observation](pairing-mode-build-2026-10-20.json) records bundle SHA-256
`bdd9e9769a7fe44c28d434d70b63ceff352101de6eed11a80fabffd07edcaaf7`
(1174524 bytes). The initial checkout guard rejected the expected generated
tracked `main.js` change; only that generated output differed. It was archived,
the original tracked output restored, and the checkout/input source verified
clean. This is a local non-release build without OAuth release proof.
[PR88](https://github.com/olalaurao/quartzo-obsidian-companion/pull/88) is draft;
final hosted checks and merge authorization remain separate.
The old preflighted artifact does not contain this fix: a newly approved main
merge and exact-main official preflight are required before using a corrected
artifact for live acceptance. G03/cloud/Obsidian/ACK remains open.

The independent exact-source offline codec diagnostic also
[passed on the actual PW3](https://github.com/olalaurao/quartzo-koplugin/blob/d3a249f/docs/evidence/wire-consumer-pw3-2026-10-20.json)
after user-confirmed KUAL execution. Its ARM/native-library/codec evidence grants
no canonical persistence, network delivery, source cursor or production effect.

### 2026-10-20 — Build, hosted CI and cross-client exchange

Runtime checkpoint `e2b1664950262c8f9a354eb7f2cd97b38d2181d2` passed [PR CI 39369670535](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39369670535) and [push CI 39369667299](https://github.com/olalaurao/quartzo-obsidian-companion/actions/runs/39369667299) on Linux, Windows and macOS. Linux/macOS full suites: **979 PASS / two skipped**; Windows sync: **366 PASS / one skipped**; Linux/macOS sync: **365 PASS / two skipped**. Both Unix contract runs have **397 PASS**. Official contract verification, audit, docs, typecheck, lint/architecture where configured, build, smoke and packaging also passed. The platform-dependent case-alias case and opt-in exchange explain the different skips. [PR86](https://github.com/olalaurao/quartzo-obsidian-companion/pull/86) is draft, not merged or released.

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

G03 has a guarded immutable lifecycle/identity and explicit repair implementation in the existing owners. Committed-source build, hosted CI, real Drive/Companion interoperability and supported-filesystem acceptance remain open. Pure or mocked tests cannot establish global exclusion, all-writer cooperation, directory/power-loss durability or canonical source acknowledgements. Remote history purge requires a separate reviewed contract.

Production Kindle extraction/outbox, deployed authenticated ingress, cursor advancement, Resource promotion/status effects, automation, analytics/UI, Readwise migration and release/rollback remain outside this checkpoint. No production installation or feature activation is implied by contract adoption.
