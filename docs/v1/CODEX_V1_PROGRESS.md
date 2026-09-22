# Codex V1 Progress

Last update: 2026-09-22T10:56:15-03:00
Current milestone: D1 E2E app <-> Drive <-> Obsidian
Current repo: Companion (`C:\Users\lauri\Documents\companion`)
Current branch: main
Current HEAD: fa889f1564f1d2be9299025756322bb26b2be191
Upstream main HEAD: e0bfa98611138512f916be9cf10f5395b78c10ed
Companion main HEAD: fa889f1564f1d2be9299025756322bb26b2be191
Open PR: none
CI status: PR #58 merged. Remote CI run 35736427247 completed successfully on `test-linux`, `test-windows`, and `test-macos`; merge SHA `fa889f1564f1d2be9299025756322bb26b2be191`.
Blocker: D1 Android -> Drive -> local vault is proven; Obsidian Companion bundle updated and vault reopened, but Codex cannot visually click the Obsidian Done button from this session. Need user/UI confirmation for Home/Planner/Day Dial and Done click, or another accessible control surface.
Exact next action: verify Companion UI in Obsidian shows `Prepare campaign` on 2026-09-23 at 10:00 and Day Dial; click Done in Companion, then sync/adopt as needed on Android and verify the Task becomes completed with no duplicate/conflict.

## 2026-09-21 - Initial handoff sync

Repo: Companion and upstream Quartzo app
Branch:
- Companion: `main`
- Upstream: `main`
HEAD:
- Companion main: 36c88af14587134d05a7fdcd12901a0b2a4e37af
- Upstream main: fb6747ac17fc67efe81964f402f7c9c492793422
Changed:
- Created this progress log only.
Local untracked/preserved:
- Companion: `COMPANION_V1_CODEX_HANDOFF.md`
- Upstream: `lib/services/aplicativo_v11_1_antigravity.code-workspace`
Existing local branch state preserved:
- Companion `feature/companion-v1-beta` is ahead of its origin by commit `149fdfecb6b26e5ac130c149f5a05a35fc94d018` (`Fix P0 bugs: SHA256 vs MD5, binary conflicts, adoption, paths, Drive Changes, file policy, baseline persistence`).
Rule/bug treated:
- Followed handoff Rule 0 before edits: fetched, switched to `main`, pulled `--ff-only`, and recorded dirty/untracked local files without discarding them.
Tests executed:
- Not yet. This was repository synchronization and checkpoint creation only.
CI:
- Upstream PR #47: `UNSTABLE`; checks red on head `2e2917545c51ab69778abd7a2cd7d84e611d2a4d`.
- Companion: no open PRs found.
Open failure:
- Upstream A7 concrete failures from PR #47 checks must be reproduced/fixed before downstream work.
Next:
- Checkout upstream branch `contracts/overdue-adaptive-planning-v1`, inspect diff, and fix only concrete A7 failures.

## 2026-09-21 - Companion bootstrap and status consultation

Repo: Companion
Branch: `main`
HEAD: 36c88af14587134d05a7fdcd12901a0b2a4e37af
Changed:
- `docs/v1/CODEX_V1_PROGRESS.md`
Read/consulted:
- `AGENT_BOOTSTRAP.md`
- `contracts/UPSTREAM.lock.json`
- `contracts/quartzo/README.md`
- `contracts/quartzo/QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md`
- `contracts/quartzo/QUARTZO_VAULT_INTEROP_CONTRACT_V1.md`
- `contracts/quartzo/QUARTZO_SYNC_PROTOCOL_V1.md`
- `contracts/quartzo/QUARTZO_COMPANION_UI_SPEC_V1.md`
- `contracts/quartzo/P0_COMPLIANCE_MATRIX.md`
- `guidelines.md`
- `agents.md`
- `docs/v1/COMPANION_V1_EXECUTION_TRACKER.md`
- `docs/BETA_RELEASE_RUNBOOK.md`
- Companion workflows: `ci.yml`, `release-preflight.yml`, `release.yml`
- Upstream workflows: `agent-contract-gate.yml`, `dial_focus_ci.yml`, `flutter-ci.yml`
- Companion issue #45
Status:
- Issue #45 confirms A6 closed and A7 started upstream-first.
- Upstream PR #47 remains open on head `2e2917545c51ab69778abd7a2cd7d84e611d2a4d`, merge state `UNSTABLE`.
- Runs still red: Dial Focus CI `35665104681`, Agent Contract Gate `35665104678`, Flutter CI `35665104719`.
- Companion has no open PRs.
Discovered/confirmed gaps:
- OAuth contract/runtime/release divergence was identified: vendored parent contract says no Desktop client secret, while Companion runtime/release/docs still required one at that point. This was classified as C3.5 blocker, not A7 work.
- `P0_COMPLIANCE_MATRIX.md` still links `.agents/AGENTS.md`; handoff says correct upstream-first later if vendored ownership applies.
Tests run:
- Not yet.
Next:
- Switch upstream to existing A7 branch.
- Read upstream bootstrap/guidelines/agents/specs from the checked-out branch.
- Inspect PR #47 diff and reproduce the concrete failures.

## 2026-09-21 - A7 upstream compile/analyze repair

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Base SHA: fb6747ac17fc67efe81964f402f7c9c492793422
Current HEAD: 2e2917545c51ab69778abd7a2cd7d84e611d2a4d
PR: olalaurao/aplicativo#47
Changed:
- `lib/services/timeline_aggregator_service.dart`
- `lib/services/overdue_projection_service.dart`
Rule/bug treated:
- Fixed concrete syntax failure from empty named parameter block in `TimelineAggregatorService.aggregateForDate`.
- Fixed concrete model name failure by using real upstream type `IdeaDefinition` instead of nonexistent `Idea`.
- No product semantics changed.
Tests run:
- `dart format lib/services/timeline_aggregator_service.dart lib/services/overdue_projection_service.dart`
- `dart analyze lib/services/timeline_aggregator_service.dart lib/services/daily_schedule_service.dart lib/services/overdue_projection_service.dart test/obsidian_companion_contracts_test.dart test/architecture/architecture_gate_test.dart`
- `dart run tool/agent_preflight.dart`
- `flutter test test/architecture/agent_contract_bootstrap_test.dart test/architecture/architecture_gate_test.dart`
- `flutter test test/occurrence_action_policy_test.dart test/occurrence_action_coordinator_test.dart`
- `flutter test test/temporal_state_resolver_test.dart test/occurrence_engine_test.dart`
- `flutter test test/adaptive_day_projection_test.dart`
- `flutter test test/obsidian_companion_contracts_test.dart`
- `flutter analyze --no-fatal-warnings --no-fatal-infos`
- Dial Focus CI local test set from `.github/workflows/dial_focus_ci.yml`
Results:
- Targeted Dart analyze: green, no issues found.
- Agent preflight: green.
- Architecture/bootstrap tests: green.
- Occurrence action tests: green.
- Temporal/occurrence engine tests: green.
- Adaptive day projection test: green.
- Companion contract vectors, including A7 overdue/adaptive vectors: green.
- Full Flutter analyze: green (`No issues found`, 46.2s).
- Dial Focus local test set: green (`166` tests passed in that command).
- Full `flutter test`: green (`1947` tests passed).
Open local state:
- Upstream worktree has uncommitted edits in the two files above.
- Preserved untracked upstream file: `lib/services/aplicativo_v11_1_antigravity.code-workspace`.
Next:
- Commit and push the minimal upstream fix.
- Monitor PR #47 required workflows on the new pushed head before merging.

## 2026-09-21 - A7 upstream full test gate

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Current HEAD: 2e2917545c51ab69778abd7a2cd7d84e611d2a4d plus local uncommitted fix
PR: olalaurao/aplicativo#47
Changed:
- No additional code changes in this checkpoint.
Tests run:
- `flutter test`
Result:
- Green: all `1947` tests passed.
Next:
- Commit/push only `lib/services/timeline_aggregator_service.dart` and `lib/services/overdue_projection_service.dart`.
- Re-check PR #47 CI on the pushed head.

## 2026-09-21 - A7 upstream fix commit

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Commit: 98076a65f9aab11f9e307d5553432d442bc60255 (`Fix A7 overdue adaptive compile errors`)
PR: olalaurao/aplicativo#47
Committed:
- `lib/services/timeline_aggregator_service.dart`
- `lib/services/overdue_projection_service.dart`
Not committed / preserved:
- `lib/services/aplicativo_v11_1_antigravity.code-workspace` remains untracked.
- Flutter generated registrant files appear modified in status due line-ending/index noise but have no actual `git diff` content and were not staged.
Local verification before commit:
- Agent Contract Gate local equivalent: green.
- Companion A7 contract vectors: green.
- Flutter analyze: green.
- Dial Focus local test set: green.
- Full `flutter test`: green (`1947` tests passed).
Next:
- Push commit `98076a65f9aab11f9e307d5553432d442bc60255` to PR #47.
- Monitor Agent Contract Gate, Dial Focus CI and Flutter CI on the pushed head.

## 2026-09-21 - A7 upstream push and remote checks queued

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Pushed commit: 98076a65f9aab11f9e307d5553432d442bc60255
PR: https://github.com/olalaurao/aplicativo/pull/47
Remote status after push:
- PR #47 is open, not draft, merge state `UNSTABLE` while checks run.
- Agent Contract Gate run `35671288563`: queued on head `98076a65f9aab11f9e307d5553432d442bc60255`.
- Dial Focus CI run `35671288562`: queued on head `98076a65f9aab11f9e307d5553432d442bc60255`.
- Flutter CI run `35671288567`: queued on head `98076a65f9aab11f9e307d5553432d442bc60255`.
Next:
- Wait for the three runs to finish.
- If any run fails, inspect the concrete failure and fix only that.
- If all required runs pass, merge upstream PR #47 before starting downstream Companion A7 work.

## 2026-09-21 - A7 upstream remote checks progress

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Head: 98076a65f9aab11f9e307d5553432d442bc60255
PR: https://github.com/olalaurao/aplicativo/pull/47
Remote checks:
- Agent Contract Gate run `35671288563`: success.
- Dial Focus CI run `35671288562`: in progress.
- Flutter CI run `35671288567`: queued.
Next:
- Continue monitoring Dial Focus CI and Flutter CI.

## 2026-09-21 - A7 upstream Dial Focus passed

Repo: upstream Quartzo app
Branch: `contracts/overdue-adaptive-planning-v1`
Head: 98076a65f9aab11f9e307d5553432d442bc60255
PR: https://github.com/olalaurao/aplicativo/pull/47
Remote checks:
- Agent Contract Gate run `35671288563`: success.
- Dial Focus CI run `35671288562`: success.
- Flutter CI run `35671288567`: queued.
Next:
- Continue monitoring Flutter CI.
- Merge PR #47 only after Flutter CI also passes.

## 2026-09-21 - Local Quartzo app path correction

User correction:
- When referring to the Quartzo app locally, use `C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`.
Verified:
- `C:\Users\lauri\Documents\aplicativo_v11_1_antigravity` is a git repo on `main...origin/main` with a clean status.
Context:
- The already-pushed upstream PR #47 fix remains on remote head `98076a65f9aab11f9e307d5553432d442bc60255`.
- Continue certification/merge against PR #47, then use the corrected local Quartzo path for future local app references.
Remote checks:
- Flutter CI Analyze job: success.
- Flutter CI Test job: in progress.
Next:
- Continue monitoring Flutter CI Test.

## 2026-09-21 - A7 upstream remote checks green

Repo: upstream Quartzo app
Head: 98076a65f9aab11f9e307d5553432d442bc60255
PR: https://github.com/olalaurao/aplicativo/pull/47
Remote checks:
- Agent Contract Gate run `35671288563`: success.
- Dial Focus CI run `35671288562`: success.
- Flutter CI run `35671288567`: success.
Next:
- Validate PR #47 merge state.
- Merge PR #47 upstream if GitHub reports it mergeable.
- After merge, sync Companion vendored upstream lock/contracts before starting downstream A7 implementation.

## 2026-09-21 - A7 upstream PR merged and downstream branch started

Upstream repo: Quartzo app (`C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`)
Upstream PR: https://github.com/olalaurao/aplicativo/pull/47
Upstream merge SHA: d9302f0860fa1a4e33c1c611f2b448bec167e51f
Upstream merge time: 2026-09-22T00:46:58Z
Verified:
- PR #47 state: `MERGED`.
- Merge method produced canonical main commit `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- Local Quartzo app main fast-forwarded to `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.

Companion repo: `C:\Users\lauri\Documents\companion`
Companion base branch: `main`
Companion base HEAD: 36c88af14587134d05a7fdcd12901a0b2a4e37af
Created branch:
- `codex/a7-overdue-adaptive-planning`
Local preserved files:
- `COMPANION_V1_CODEX_HANDOFF.md` remains untracked.
- `docs/v1/CODEX_V1_PROGRESS.md` is the active progress log.
Next:
- Run `node scripts/sync-contracts.mjs sync d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- Run `npm run contracts:verify`.
- Inspect vendored A7 contract/vector changes before implementing downstream owners.

## 2026-09-21 - A7 Companion repin first attempt blocked

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Command:
- `node scripts/sync-contracts.mjs sync d9302f0860fa1a4e33c1c611f2b448bec167e51f`
- `npm run contracts:verify`
Result:
- Failed before vendoring because GitHub API returned `HTTP 404` for private upstream commits.
- Existing `contracts:verify` also failed with `HTTP 404` against the previously pinned commit, confirming this is token/env access rather than an A7 content mismatch.
- Node additionally printed `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` after the failed fetch.
Next:
- Set `GITHUB_TOKEN` from `gh auth token` for this process and rerun the same sync/verify commands.

## 2026-09-21 - A7 Companion repin verified

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Upstream pin: d9302f0860fa1a4e33c1c611f2b448bec167e51f
Changed:
- `contracts/UPSTREAM.lock.json`
- `contracts/quartzo/contract_manifest.json`
- `contracts/quartzo/QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md`
- `contracts/quartzo/daily_schedule/vectors.json`
- `contracts/quartzo/adaptive_planning/vectors.json`
- `contracts/quartzo/overdue_projection/vectors.json`
Contract versions after repin:
- `dailyScheduleContractVersion = 1.1.0`
- `overdueProjectionContractVersion = 1.0.0`
- `adaptivePlanningContractVersion = 1.0.0`
Commands:
- `$env:GITHUB_TOKEN = gh auth token; node scripts/sync-contracts.mjs sync d9302f0860fa1a4e33c1c611f2b448bec167e51f`
- `npm run contracts:verify`
Result:
- Sync: `PASS: vendored 22 files from olalaurao/aplicativo@d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- Verify: `PASS: 22 contracts verified byte-for-byte against olalaurao/aplicativo@d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
Next:
- Inspect existing owners before editing: Daily Schedule, SharedPlanningStateRepository, Adaptive projection, Home, Journal and architecture gate.

## 2026-09-21 - A7 Companion downstream implementation first pass

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Changed:
- `src/core/daily_schedule/engine.ts`
- `src/core/adaptive_planning.ts`
- `src/core/overdue_projection.ts`
- `src/vault/planning-state.ts`
- `src/ui/planner/adaptive-projection.ts`
- `src/ui/planner/view.ts`
- `src/ui/home/home-projection.ts`
- `src/ui/home/view.ts`
- `src/ui/journal/journal-projection.ts`
- `src/ui/shell/view.ts`
- `src/ui/types.ts`
- `src/main.ts`
- `scripts/architecture-check.mjs`
- focused tests for Daily Schedule, Overdue, Adaptive, Home and Journal
Rules/bugs treated:
- Daily Schedule no longer carries an overdue Reminder into today's normal date snapshot.
- Overdue is a separate pure core projection driven only by real deadlines/due times.
- Home and Journal consume the same Overdue projection; they do not mix it into `today`.
- `SharedPlanningStateRepository` remains the single owner of `sessions/shared_planning_state_v1.md`, now loading DailyPlanningState as well as A6/A3 occurrence time overrides.
- Adaptive consumes exact essential/parked occurrence IDs from DailyPlanningState.
- Completed essentials drop from the visible Essentials projection.
- Parked occurrence IDs are filtered out of visible Adaptive buckets.
- `capacity_mode` is surfaced; numeric capacity remains `null` / unavailable and is not computed locally.
- Fixed existing date-only parsing drift in person contact Daily Schedule vector by using `parseLocalIsoDate`.
Tests run:
- `npx vitest run tests/contracts/daily_schedule.test.ts tests/contracts/overdue_projection.test.ts tests/core/adaptive-planning-state.test.ts tests/ui/planner-adaptive-projection.test.ts tests/ui/home-projection.test.ts tests/ui/journal-projection.test.ts`
- `npm run typecheck`
- `npm run architecture:check`
Results:
- Focused A7 tests: green (`54` tests passed).
- Typecheck: green.
- Architecture gate: green.
Next:
- Run broader Companion contract/full test/lint/build gates.

## 2026-09-21 - A7 Companion local gates green

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Upstream pin: d9302f0860fa1a4e33c1c611f2b448bec167e51f
Gates run:
- `npm ci --audit=false`
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify`
- `npm run test:contracts`
- `npm test`
- `npm run lint`
- `npm run test:sync`
- `npm run typecheck`
- `npm run architecture:check`
- `npm run build`
- `npm run release:validate`
- `npm run smoke:clean-artifact`
- `npm run release:package`
- `npm run audit:prod`
Results:
- Contract verify: green (`22` contracts verified byte-for-byte).
- Contract suite: green (`252` tests passed).
- Full test suite: green on rerun (`581` tests passed). First full run had one unrelated `tests/sync/regression.test.ts` timeout in `GoogleDriveAdapter exposes withRetry via unknown cast`; the isolated rerun passed in `102ms`, and the full rerun passed cleanly.
- Lint: green.
- Sync suite: green (`223` tests passed).
- Typecheck: green, including after `npm ci`.
- Architecture gate: green.
- Build/release validate/smoke/package: green; release artifact staged at `.release-artifact`.
- Production audit: green, `0` vulnerabilities.
Notes:
- `COMPANION_V1_CODEX_HANDOFF.md` remains untracked and should not be committed.
- `.release-artifact` is generated output and remains outside the tracked diff.
Next:
- Stage A7-C source/contracts/tests/progress only.
- Commit, push, open Companion PR.

## 2026-09-21 - A7 Companion commit created

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Commit: `Port A7 overdue adaptive planning` on branch `codex/a7-overdue-adaptive-planning`
Committed:
- Upstream repin to `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- A7 Daily Schedule, Overdue and Adaptive downstream implementation.
- A7 contract/vector tests and architecture gate updates.
- `docs/v1/CODEX_V1_PROGRESS.md`.
Not committed:
- `COMPANION_V1_CODEX_HANDOFF.md` remains untracked by design.
Next:
- Amend this progress entry into the commit.
- Push branch and open Companion A7 PR.

## 2026-09-21 - A7 Companion PR opened

Repo: Companion
Branch: `codex/a7-overdue-adaptive-planning`
Head: 47a1750281271f4573a29114d9a5cb68251962dd
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/49
Status:
- PR #49 open, not draft.
- Merge state: `UNSTABLE` while checks run.
- CI run `35674638638` started on head `47a1750281271f4573a29114d9a5cb68251962dd`.
- `test-linux`: in progress.
- `test-windows`: in progress.
Next:
- Wait for CI run `35674638638`.
- If any job fails, inspect the concrete failure and fix only that.
- If CI passes, merge PR #49, then update tracker and issue #45.

## 2026-09-21 - A7 Companion PR CI green

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/49
Head checked: 47a1750281271f4573a29114d9a5cb68251962dd
CI run: 35674638638
Result:
- `test-linux`: success.
- `test-windows`: success.
Linux job covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Windows job covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #49 if the rerun remains green.

## 2026-09-21 - A7 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/49
Final PR head: 7776ad7b274ecf5d2c733aaf8b0b9c051ab79128
Merge SHA: bbd285f1b94ddbfd6ab44fb17254d12ca3198209
Merged at: 2026-09-22T01:11:49Z
Final CI run: 35674749253
Result:
- `test-linux`: success.
- `test-windows`: success.
Tracker updates:
- A7 marked closed.
- Focus/Pomodoro parity stale checkbox reconciled to closed based on certified A5.
Next:
- Commit/push tracker and progress closeout.
- Add issue #45 progress comment.
- Continue with B1 unless redirected.

## 2026-09-21 - A7/B0 closeout pushed, B1 branch started

Repo: Companion
Main closeout commit: e2007cfccecc50cf57c7e1e1885464c8f2641460 (`docs: close A7 overdue adaptive milestone`)
Issue comment: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5769841890
Created branch:
- `codex/b1-surface-acceptance-polish`
Scope:
- B1 Home / Planner / Day Dial / Detail / Search / Browse / Journal acceptance and polish final.
- No redesign.
- No new product rule without upstream/contract backing.
- No mutation expansion beyond coverage matrix.
Next:
- Audit existing surfaces and tests.
- Implement only real gaps found.

## 2026-09-21 - B1 surface acceptance audit and local fixes

Repo: Companion
Branch: `codex/b1-surface-acceptance-polish`
Base HEAD: e2007cfccecc50cf57c7e1e1885464c8f2641460
Changed:
- `src/ui/home/quick-actions.ts`
- `src/ui/home/view.ts`
- `tests/ui/home-quick-actions.test.ts`
- `tests/contracts/ui_shell.test.ts`
- `contracts/UPSTREAM.lock.json`
- `docs/v1/CODEX_V1_PROGRESS.md`
Audit:
- Home/Planner/Day Dial/Detail/Search/Browse/Journal reviewed against B1 handoff and UI contract.
- Search/Browse/pickers continue to use `src/core/object-query/index.ts`; no second search cache found.
- Universal Detail edit controls remain gated by vendored full mutation coverage; limited/daily_note stay read-only/Open Markdown.
- Planner Day/Week/Month and Day Dial use canonical schedule inputs and presentation-only projections.
- Journal uses indexed Daily Note/Entry/Record objects plus canonical timeline and Overdue projection.
- Focus surface review only: foreign owner is read-only, controls disable via `canControl`, ticker clears when root disconnects.
Concrete B1 gaps fixed:
- Home quick actions now expose every Quick Add type currently supported by the creation core: Task, Entry, Note, Reminder, Record and Resource.
- Quick Add contract test now proves Record and Resource roundtrip alongside Task/Entry/Note/Reminder.
Gate repair:
- Initial `npm run contracts:verify` failed without token (`HTTP 404`), then with token exposed a stale `UPSTREAM.lock.json` manifest mismatch for existing vendored A7 files.
- Ran official repin on the same upstream SHA `d9302f0860fa1a4e33c1c611f2b448bec167e51f`; vendored file bytes stayed aligned, and the only contract diff is the lock `syncTimestamp`.
Tests run:
- `npx vitest run tests/ui/home-quick-actions.test.ts tests/ui/home-projection.test.ts` — green, 7 tests.
- `npm run typecheck` — green.
- `npx vitest run tests/contracts/ui_shell.test.ts tests/ui/home-quick-actions.test.ts tests/core/object-creation.test.ts` — green, 16 tests.
- `npm run test:contracts` — green, 254 tests.
- `npm run lint` — green.
- `npm run architecture:check` — green.
- `npm test` — green, 584 tests.
- `npm run build` — green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` — green after same-SHA repin, 22 contracts verified.
Still open:
- OAuth contract/runtime divergence remains C3.5 blocker.
- P0 matrix `.agents/AGENTS.md` stale link remains later C4/upstream-owned, not B1.
Next:
- Stage only the B1 source/tests/lock/progress changes and leave `COMPANION_V1_CODEX_HANDOFF.md` untracked.
- Commit, push, open PR B1 and monitor remote CI.

## 2026-09-21 - B1 PR opened and first CI green

Repo: Companion
Branch: `codex/b1-surface-acceptance-polish`
Commit: 6a13f6f79966899ae92bafad2c7fadae0fc00f4f (`Polish B1 surface quick add acceptance`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/50
CI run: 35675702249
Result:
- `test-linux`: success.
- `test-windows`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #50 if the rerun remains green.

## 2026-09-21 - B1 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/50
Final PR head: 4eea8a27684b576e52099281de5962f73c653f70
Merge SHA: c6ea5773a261a73b65bb085970054c154c443234
Merged at: 2026-09-22T01:28:53Z
Final CI run: 35675821273
Result:
- `test-linux`: success.
- `test-windows`: success.
Tracker updates:
- B1 Home/Planner/Dial/Detail/Search/Browse/Journal polish final marked closed.
- Added B1 closed section with PR #50, final head, merge SHA and CI evidence.
Still open:
- B2 Reminder/Calendar edge-case closure.
- B3 Sync Center diagnostics.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout commit pushed to main: `011115028700d76e873a34dfc8e785623fc3c9db`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5769959113
- Start B2 unless redirected.

## 2026-09-21 - B2 Reminder/Calendar edge audit started

Repo: Companion
Branch: `codex/b2-reminder-calendar-edge-closure`
Base HEAD: f21c1385fe23d8aa7aba4fa36e8c0b24d42d7fe8
Changed:
- `tests/core/reminder-projection.test.ts`
- `tests/core/occurrence-action-service.test.ts`
- `tests/integrations/google-calendar.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`
Audit:
- Reminder owners reviewed: projection, service, device-local notification registry, notification gateway, occurrence action service and Settings permission/status surface.
- Calendar owners reviewed: Google Calendar adapter, Daily Schedule Google projection, shell usage and HTTPS-only browser opener.
Concrete B2 coverage added:
- Reminder `minutes_before` crossing the previous local calendar day.
- Reminder delivery occurrence preserves valid `escalation_level` and notification body.
- Reminder dismiss is recorded through the canonical occurrence action owner and is idempotent by action ID.
- Google Calendar follows calendar-list pagination and per-calendar event pagination.
- Google Calendar surfaces non-authorization API and network errors to caller; plugin remains responsible for fail-closed UI status.
Tests run:
- `npx vitest run tests/core/reminder-projection.test.ts tests/core/reminder-service.test.ts tests/core/occurrence-action-service.test.ts tests/integrations/google-calendar.test.ts tests/core/google-calendar-schedule.test.ts tests/reminder-notifications.test.ts tests/local-state/notification-delivery-registry.test.ts` — green, 27 tests.
- `npm run typecheck` — green.
- `npm run test:contracts` — green, 254 tests.
- `npm run lint` — green.
- `npm run architecture:check` — green.
- `npm test` — green, 589 tests.
- `npm run build` — green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` — green, 22 contracts verified.
Result:
- No runtime owner changes were needed; B2 changes are executable acceptance coverage over existing Reminder/Calendar owners.
Next:
- Commit and push B2 branch.
- Open PR B2 and monitor remote CI.

## 2026-09-21 - B2 PR opened and first CI green

Repo: Companion
Branch: `codex/b2-reminder-calendar-edge-closure`
Commit: d3d2ebff79d4c30a39146d1ac74cbef15d2f620c (`Add B2 reminder calendar edge coverage`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/51
CI run: 35676397856
Result:
- `test-linux`: success.
- `test-windows`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #51 if the rerun remains green.

## 2026-09-21 - B2 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/51
Final PR head: f85cbf782c61bce67a10f1f8ad7e14473e62ffe0
Merge SHA: 6e340fed9380820f768baa089dd2aa5547a5220f
Merged at: 2026-09-22T01:39Z
Final CI run: 35676498790
Result:
- `test-linux`: success.
- `test-windows`: success.
Closed B2 evidence:
- Reminder `minutes_before` crossing previous local day.
- Reminder `escalation_level` and notification body preservation.
- Reminder `Dismiss` through canonical occurrence action owner, idempotent by action ID.
- Google Calendar calendar-list pagination and event pagination.
- Google Calendar non-auth API/network error propagation.
Tracker updates:
- B2 Reminder/Calendar edge-case closure marked closed.
- Added B2 closed section with PR #51, final head, merge SHA and CI evidence.
Still open:
- B3 Sync Center diagnostics finais sem reescrever o sync.
- C1 UI/UX + accessibility pass.
- C2 performance/lifecycle/race pass.
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout docs commit pushed to main: `5717523fdafe1845d6c63123ab8a845cde035e98`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5770039783
- Start B3 from updated main unless redirected.

## 2026-09-21 - B3 Sync Center diagnostics implementation checkpoint

Repo: Companion
Branch: `codex/b3-sync-center-diagnostics`
Base HEAD: 77560da1c9239918acaf9a1f526931fbce98fa58
Changed:
- `src/sync/coordinator/index.ts`
- `src/ui/shell/view.ts`
- `tests/sync/runtime.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`
Implemented:
- `SyncStatusSnapshot` now exposes typed `pendingDiagnostics` from `DriveSyncCoordinator`.
- `pendingLocalChanges` is derived from the diagnostics list.
- Diagnostics are based on real coordinator state: local create, local modify, pending delete, pending rename, adoption required, conflict and quarantined duplicate identity.
- Sync Center renders pending path/reason diagnostics and can copy the same snapshot for support/debugging.
Boundary preserved:
- No second sync queue.
- No new reconciliation engine.
- No new canonical persistence.
- UI does not infer reason from error text.
Tests run:
- `npx vitest run tests/sync/runtime.test.ts` — green, 77 tests.
- `npm run typecheck` — green.
- `npm run lint` — green.
- `npm run test:sync` — green, 226 tests.
- `npm run architecture:check` — green.
- `npm test` — green, 592 tests.
- `npm run test:contracts` — green, 254 tests.
- `npm run build` — green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` — green, 22 contracts verified.
- `npm run audit:prod` — green, zero vulnerabilities.
- `npm run release:validate` — green.
- `npm run smoke:clean-artifact` — green.
- `npm run release:package` — green.
Still open:
- Commit/push B3 branch and open PR if green.
Next:
- Commit/push B3 branch and open PR.

## 2026-09-21 - B3 PR opened and first CI green

Repo: Companion
Branch: `codex/b3-sync-center-diagnostics`
Commit: c2bbfa333514c4de86eec05b12a16aabb1e520e2 (`Add Sync Center pending diagnostics`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/52
CI run: 35677137335
Result:
- `test-linux`: success.
- `test-windows`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #52 if the rerun remains green.

## 2026-09-21 - B3 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/52
Final PR head: 68453db5f0143fa5cb50c285721c81cac200a08c
Merge SHA: 7598ec7d7df86537447eb329b25567a93e1567a5
Merged at: 2026-09-22T01:52Z
Final CI run: 35677272561
Result:
- `test-linux`: success.
- `test-windows`: success.
Closed B3 evidence:
- `SyncStatusSnapshot.pendingDiagnostics` is typed and coordinator-owned.
- `pendingLocalChanges` is derived from the diagnostics list.
- Diagnostics cover local create/modify, pending delete/rename, adoption required, conflict and quarantined duplicate identity.
- Sync Center renders and copies pending path/reason diagnostics.
- No second sync queue, reconciliation engine, canonical persistence, or UI error-text parsing was added.
Tracker updates:
- B3 Sync Center diagnostics finais sem reescrever o sync marked closed.
- C pending-sync path + reason diagnostics marked closed.
- Added B3 closed section with PR #52, final head, merge SHA and CI evidence.
Still open:
- C1 UI/UX + accessibility pass.
- C2 performance/lifecycle/race pass.
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout docs commit pushed to main: `cf0922c82f000532b97e907ffbb2b313654273dc`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5770120459
- Start C1 from updated main unless redirected.

## 2026-09-21 - C1 UI/UX accessibility implementation checkpoint

Repo: Companion
Branch: `codex/c1-ui-accessibility-pass`
Base HEAD: 60635d8268298588672ee7ab78443bf38a417779
Changed:
- `src/ui/day-dial/view.ts`
- `src/ui/quick-add/modal.ts`
- `src/ui/shell/view.ts`
- `styles.css`
- `tests/contracts/ui_shell.test.ts`
- `tests/ui/day-dial-accessibility.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`
Implemented:
- Shell navigation/actions expose current/pressed state.
- Planner and Journal arrow/date controls have accessible names.
- Browse/Search inputs and filters have accessible names.
- Sync loading, warning, summary, last error and progress use status/alert/live-region semantics.
- Disabled sync/pairing controls explain why they are disabled.
- Quick Add fields and metadata status have accessible names/status.
- Day Dial exposes done/skipped in accessible labels and visible legend/chip text, not only color/opacity.
- CSS adds visible keyboard focus and wraps long diagnostics/errors/conflict content.
Tests run:
- `npx vitest run tests/ui/day-dial-accessibility.test.ts tests/contracts/ui_shell.test.ts` — green, 13 tests.
- `npm run typecheck` — green.
- `npm run lint` — green.
- `npm run test:contracts` — green, 255 tests.
- `npm test` — green, 594 tests.
- `npm run architecture:check` — green.
- `npm run build` — green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` — green, 22 contracts verified.
- `npm run audit:prod` — green, zero vulnerabilities.
- `npm run release:validate` — green.
- `npm run smoke:clean-artifact` — green.
- `npm run release:package` — green.
Still open:
- Remote PR CI.
- C2 performance/lifecycle/race pass.
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Commit/push C1 branch and open PR.

## 2026-09-21 - C1 PR opened and first CI green

Repo: Companion
Branch: `codex/c1-ui-accessibility-pass`
Commit: 32e717027b93177f3ed7da6368674208cb52709d (`Improve C1 accessibility surfaces`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/53
CI run: 35677820693
Result:
- `test-linux`: success.
- `test-windows`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #53 if the rerun remains green.

## 2026-09-21 - C1 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/53
Final PR head: 82ec36acaa19a5e16c3bf26fe21905dad32f7b14
Merge SHA: 49ba27c6784e4732804d7eceacf7214996680532
Merged at: 2026-09-22T02:03Z
Final CI run: 35677969176
Result:
- `test-linux`: success.
- `test-windows`: success.
Closed C1 evidence:
- Shell, Planner, Journal, Browse/Search and Quick Add controls have accessible names/current/pressed state where needed.
- Loading/warning/sync/error/progress/metadata states use status/alert/live-region semantics.
- Disabled sync/pairing controls expose context.
- Day Dial no longer depends only on color/opacity for Done/Skipped.
- CSS covers keyboard focus visibility and long diagnostics/error/conflict wrapping.
Tracker updates:
- C1 UI/UX + accessibility pass marked closed.
- Added C1 closed section with PR #53, final head, merge SHA and CI evidence.
Still open:
- C2 performance/lifecycle/race pass.
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout docs commit pushed to main: `c06ebf1ce68c07f732b4d68767e6113e96e9de78`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5770195551
- Start C2 from updated main unless redirected.

## 2026-09-21 - C2 lifecycle/race implementation checkpoint

Repo: Companion
Branch: `codex/c2-lifecycle-race-hardening`
Base HEAD: d7be18360f6defb496e63cc1d84b0d94af72fc16
Changed:
- `src/main.ts`
- `src/ui/shell/view.ts`
- `scripts/architecture-check.mjs`
- `tests/contracts/ui_shell.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`
Implemented:
- Shell renders now carry a generation token so stale Home/Planner/Journal/Sync async callbacks cannot mutate an older disconnected render.
- Planner captures date/mode/lens per render; Week/Month continue fetching Calendar once per range, not per item.
- Sync Center progress callbacks and final rerender check the same render generation.
- Plugin unload now guards late Calendar/OAuth/Vault index/Drive watcher/shared-state callbacks before mutating state or UI.
- OAuth loopback flows still abort on unload through the existing `oauthClient.abort()` path.
- Initial VaultIndex remains a single startup build after workspace layout readiness; vault create/modify/delete/rename remain incremental event updates.
- Shared settings changes are serialized: one active reload/reindex, with at most one requested rerun for concurrent file events.
- Architecture gate now permanently checks the C2 lifecycle/race guards and shared-settings coalescing.
Boundary preserved:
- No sync protocol changes.
- No new canonical cache or second index owner.
- No Calendar mutation or per-item Calendar fetch.
Tests run:
- `npx vitest run tests/contracts/ui_shell.test.ts` - green, 15 tests.
- `npm run typecheck` - green.
- `npm run architecture:check` - green.
- `npm run lint` - green.
- `npm run test:contracts` - green, 258 tests.
- `npm run test:sync` - green, 226 tests.
- `npm test` - green, 597 tests.
- `npm run build` - green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` - green, 22 contracts verified.
- `npm run audit:prod` - green, zero vulnerabilities.
- `npm run release:validate` - green.
- `npm run smoke:clean-artifact` - green.
- `npm run release:package` - green.
Still open:
- Remote PR CI.
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Commit/push C2 branch and open PR.
- Wait for Linux/Windows CI on the pushed head.

## 2026-09-21 - C2 PR opened and first CI green

Repo: Companion
Branch: `codex/c2-lifecycle-race-hardening`
Commit: 8c5a2f13938c9ad53fa88a9801aeb6f961464ca5 (`Harden C2 lifecycle race handling`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/54
CI run: 35678891223
Result:
- `test-linux`: success.
- `test-windows`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #54 if the rerun remains green.

## 2026-09-21 - C2 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/54
Final PR head: bdd4ec3147ce13ab589ce504aad0805cb6742c4d
Merge SHA: 6ccb085aaf3cfe5331ca05ac47e56ef7c480b825
Merged at: 2026-09-22T02:20:34Z
Final CI run: 35679013301
Result:
- `test-linux`: success.
- `test-windows`: success.
Closed C2 evidence:
- Render generation guards reject stale Home/Planner/Journal/Sync async callbacks before mutating old UI.
- Planner date/mode/lens snapshots prevent quick navigation/lens changes from being contaminated by old Calendar responses.
- Week/Month Calendar reads remain one range fetch, not per item.
- Unload guards cover late Calendar/OAuth/Vault index/Drive watcher/shared-state callbacks; OAuth abort remains in `onunload`.
- Shared settings reload/reindex is coalesced into one active reindex plus one requested rerun.
- Architecture gate now enforces C2 lifecycle/race invariants.
- No sync protocol, canonical cache, second index owner or Calendar mutation was added.
Tracker updates:
- C2 performance/lifecycle/race pass marked closed.
- Added C2 closed section with PR #54, final head, merge SHA and CI evidence.
Still open:
- C3 macOS CI.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout docs commit pushed to main: `863b359ee0b4d37b9ecac1de4921778920b52d45`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5770312955
- Start C3 from updated main unless redirected.

## 2026-09-21 - C3 macOS CI implementation checkpoint

Repo: Companion
Branch: `codex/c3-macos-ci-release-gates`
Base HEAD: 41096a1d5d9c16b2d5a8dada53b687b456c319c5
Changed:
- `.github/workflows/ci.yml`
- `scripts/architecture-check.mjs`
- `tests/contracts/ci-workflows.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`
Implemented:
- Added `test-macos` job on `macos-latest`.
- macOS job runs npm install, pinned audit client, production audit, contract verify with upstream token, typecheck, lint, full tests, contract tests, sync tests, architecture, build, release validate, clean artifact smoke and package.
- Architecture check now requires macOS CI parity and all three CI platforms using the canonical audit gate.
- Contract test added for the macOS workflow gates.
Boundary:
- Release/preflight OAuth behavior intentionally unchanged; OAuth contract/runtime/release divergence remains C3.5.
Tests run:
- `npx vitest run tests/contracts/ci-workflows.test.ts` - green, 1 test.
- `npm run test:contracts` - green, 259 tests.
- `npm run typecheck` - green.
- `npm run architecture:check` - green.
- `npm run lint` - green.
- `npm run test:sync` - green, 226 tests.
- `npm test` - green, 598 tests.
- `npm run build` - green.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` - green, 22 contracts verified.
- `npm run audit:prod` - green, zero vulnerabilities.
- `npm run release:validate` - green.
- `npm run smoke:clean-artifact` - green.
- `npm run release:package` - green.
Still open:
- Remote PR CI, especially first macOS run.
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Commit/push C3 branch and open PR.
- Wait for Linux/Windows/macOS CI on the pushed head.

## 2026-09-21 - C3 PR opened and first CI green

Repo: Companion
Branch: `codex/c3-macos-ci-release-gates`
Commit: 1f4267cd4be35dcb2cc628a146b4bc62df7e4a44 (`Add macOS CI release gate parity`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/55
CI run: 35679365316
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Remote macOS covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #55 if the rerun remains green.

## 2026-09-21 - C3 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/55
Final PR head: 3a6e2f3a45b6a185b86f344c13e7c49586420128
Merge SHA: 49b27e02878ae1f2c5348ebefd845d989e0f5d7f
Merged at: 2026-09-22T02:28:10Z
Final CI run: 35679476172
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Closed C3 evidence:
- Main CI now includes `test-macos` on `macos-latest`.
- macOS runs production audit, contracts verify, typecheck, lint, full tests, contract tests, sync tests, architecture, build, release validate, clean artifact smoke and package.
- Architecture gate enforces macOS CI parity and audit gate use across Linux, Windows and macOS.
- Contract test covers the macOS workflow gates.
- Release/preflight OAuth behavior intentionally unchanged; OAuth divergence remains C3.5.
Tracker updates:
- C3 macOS CI marked closed.
- Added C3 closed section with PR #55, final head, merge SHA and CI evidence.
Still open:
- C3.5 OAuth contract/runtime/release divergence.
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Closeout docs commit pushed to main: `367deac0c36f5d5197355fc657a40fe1ce9867ee`.
- Issue #45 progress comment added: https://github.com/olalaurao/quartzo-obsidian-companion/issues/45#issuecomment-5770363499
- Start C3.5 upstream-first unless redirected.

## 2026-09-21 - C3.5 OAuth no-secret implementation checkpoint

Repo: Companion
Branch: `codex/c35-oauth-no-client-secret`
Base HEAD: 09cd76cdaa538a522a9d37f3afe580b4592d4d57
Upstream Quartzo app path verified:
- `C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`
Upstream main HEAD verified:
- `d9302f0860fa1a4e33c1c611f2b448bec167e51f`
Google source consultation:
- Google installed/native app guidance says installed apps cannot keep secrets and desktop app authorization uses PKCE.
- Google token exchange documentation lists `client_secret` as optional and not applicable to public native client cases.
- Google OAuth best practices say client credentials should not be hardcoded or published.
Inference:
- Upstream contract already matches the secure public-client boundary: Desktop OAuth uses Client ID + loopback PKCE and must not contain a client secret.
- No upstream contract patch was needed for C3.5; Companion runtime, release workflows, validator, docs and tests were the divergent downstream surfaces.
Changed:
- Removed `clientSecret` from OAuth config types and Google loopback token/refresh requests.
- Removed Desktop OAuth Client Secret from Obsidian SecretStorage IDs and Settings UI.
- Removed `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET` from esbuild injection, release workflow and release preflight.
- Release validator now rejects any built artifact containing `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET`.
- Architecture gate now enforces Client ID + PKCE only, no SecretStorage ID, no runtime parameter and no release workflow secret.
- Tests now assert authorization-code and refresh-token exchanges do not send `client_secret`.
- README, beta runbook and OAuth setup docs now document only `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID`.
Tests run:
- `npx vitest run tests/integrations/google-oauth-loopback.test.ts tests/sync/regression.test.ts` - green, 96 tests.
- `npm run typecheck` - green.
- `npm run architecture:check` - green.
- `npm run build` - green.
- `npm run release:validate` - green.
- `RELEASE_MODE=true QUARTZO_GOOGLE_DESKTOP_CLIENT_ID=test-client.apps.googleusercontent.com` with no `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET`: `npm run build` + `npm run release:validate` - green.
- `npm run lint` - green.
- `npm run test:contracts` - green, 259 tests.
- `npm run test:sync` - green, 226 tests.
- `npm test` - green, 598 tests.
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` - green, 22 contracts verified byte-for-byte against upstream `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- `npm run audit:prod` - green, zero vulnerabilities.
- `npm run smoke:clean-artifact` - green.
- `npm run release:package` - green.
Still open:
- Push first remote CI checkpoint.
- Wait for progress-only CI rerun.
- Merge only after remote CI rerun is green, then update tracker and issue #45.

## 2026-09-21 - C3.5 PR opened and first CI green

Repo: Companion
Branch: `codex/c35-oauth-no-client-secret`
Commit: 495d3e3046748ded43d67edbf0ec105f8c93897d (`Align OAuth desktop flow with no-secret contract`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/56
CI run: 35680157336
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Remote macOS covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #56 if the rerun remains green.

## 2026-09-21 - C3.5 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/56
Final PR head: 9b912ca2b0f91e742313e82cf545e8d8bd399d9a
Merge SHA: 5c96485a91be1a20243dce32f38fbcaa89ac2f2b
Merged at: 2026-09-22T02:41:32Z
Final CI run: 35680269632
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Closed C3.5 evidence:
- Desktop OAuth runtime now uses Client ID + loopback PKCE only.
- Authorization-code exchange and refresh-token exchange no longer send `client_secret`.
- Obsidian SecretStorage stores only the refresh token; no Desktop OAuth Client Secret ID remains.
- Settings UI no longer asks for or stores a Desktop OAuth Client Secret.
- Release and preflight workflows require only `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID`.
- `release:validate` rejects a built artifact containing `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET`.
- Architecture and regression tests enforce no secret in runtime, release workflows or SecretStorage.
- README, beta release runbook and OAuth setup docs now document the no-secret desktop flow.
Tracker updates:
- C3.5 OAuth contract/runtime/release divergence marked closed.
Still open:
- C4 stale docs/capability matrix, including P0 `.agents/AGENTS.md` link.
Next:
- Push this closeout docs commit to main.
- Add issue #45 progress comment for C3.5.
- Start C4 from updated main unless redirected.

## 2026-09-22 - C4 upstream P0 matrix link cleanup

Repo: upstream Quartzo app (`C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`)
Branch: `codex/c4-p0-matrix-link-docs`
PR: https://github.com/olalaurao/aplicativo/pull/48
Final PR head: 6abb27dd235a0d493a2d5df29b8f506d7a2bc4f9
Merge SHA: e0bfa98611138512f916be9cf10f5395b78c10ed
Merged at: 2026-09-22T03:03:53Z
Changed:
- `docs/integrations/obsidian_companion/P0_COMPLIANCE_MATRIX.md`
Rule/bug treated:
- Replaced repository-relative Markdown links with literal repo paths so the matrix remains valid when vendored into Companion.
- This corrected the stale Companion-local `.agents/AGENTS.md` link at the upstream-owned source instead of editing the vendored copy by hand.
Local upstream tests:
- `dart run tool/agent_preflight.dart` - green.
- `flutter test test/architecture/agent_contract_bootstrap_test.dart test/obsidian_companion_contracts_test.dart` - green, 26 tests.
Remote upstream CI:
- Agent Contract Gate run `35680600034`: success.
- Flutter CI run `35680600011`: Analyze success; Test success.
Next:
- Repin Companion contracts to upstream merge SHA `e0bfa98611138512f916be9cf10f5395b78c10ed`.

## 2026-09-22 - C4 Companion docs/capability checkpoint

Repo: Companion
Branch: `codex/c4-v1-docs-capability-matrix`
Base HEAD: 800f3394df0fb74dc551c6ed8f9d8b5307ade1b5
Upstream pin:
- `e0bfa98611138512f916be9cf10f5395b78c10ed`
Changed:
- `contracts/UPSTREAM.lock.json`
- `contracts/quartzo/P0_COMPLIANCE_MATRIX.md`
- `docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md`
- `docs/INSTALL_BRAT.md`
- `README.md`
- `docs/BETA_RELEASE_RUNBOOK.md`
- `scripts/architecture-check.mjs`
Implemented:
- Created the final V1 capability matrix with Full / Read-only / Unsupported status, owner, contract/vector, test/gate, platform and V1 limitations.
- Updated BRAT install docs to stop pinning stale `0.1.0-beta.1` and `feature/companion-v1-beta`.
- Linked the V1 capability matrix from README and beta release runbook.
- Added an architecture gate for C4 docs: matrix coverage, BRAT stale text, vendored P0 `.agents/AGENTS.md` broken link, and no-secret OAuth doc boundary.
- Repinned vendored contracts byte-for-byte to upstream `e0bfa98611138512f916be9cf10f5395b78c10ed`.
Tests run:
- `$env:GITHUB_TOKEN = gh auth token; npm run contracts:verify` - green, 22 contracts verified byte-for-byte.
- `npm run architecture:check` - green, including new C4 release docs/capability matrix gate.
- `npm run typecheck` - green.
- `npm run lint` - green.
- `npm run test:contracts` - green, 259 tests.
- `npm run test:sync` - first run had the known `GoogleDriveAdapter exposes withRetry via unknown cast` 5000ms timeout while heavy suites were parallelized; isolated rerun passed in 117ms, then full `npm run test:sync` rerun passed, 226 tests.
- `npm test` - first run hit the same timeout; rerun passed, 598 tests.
- `npm run build` - green.
- `npm run release:validate` - green.
- `npm run audit:prod` - green, zero vulnerabilities.
- `npm run smoke:clean-artifact` - green.
- `npm run release:package` - green.
Still open:
- Push first remote CI checkpoint.
- Wait for progress-only CI rerun.
- Merge only after remote CI is green, then update tracker and issue #45.

## 2026-09-22 - C4 PR opened and first CI green

Repo: Companion
Branch: `codex/c4-v1-docs-capability-matrix`
Commit: 12513f162a64439452b461ed28c82b8d7e10f1a8 (`Add C4 V1 capability matrix`)
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/57
CI run: 35682167304
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Remote Linux covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Remote Windows covered:
- `npm ci --audit=false`
- production audit
- typecheck
- sync tests
- build
- clean artifact smoke
- package
Remote macOS covered:
- `npm ci --audit=false`
- production audit
- contract verify
- typecheck
- lint
- `npm test`
- `npm run test:contracts`
- `npm run test:sync`
- architecture
- build
- release validate
- clean artifact smoke
- package
Next:
- Commit/push this progress checkpoint.
- Wait for the progress-only CI rerun.
- Merge PR #57 if the rerun remains green.

## 2026-09-22 - C4 Companion merged

Repo: Companion
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/57
Final PR head: 8c7802c0515413d11cd1c696b2cac37c611e888a
Merge SHA: cd4acf3926b880f62b8da1c15f96e3fef356ae1c
Merged at: 2026-09-22T03:14:39Z
Final CI run: 35682290980
Result:
- `test-linux`: success.
- `test-windows`: success.
- `test-macos`: success.
Closed C4 evidence:
- Upstream PR #48 corrected the P0 matrix stale `.agents/AGENTS.md` link at the canonical source.
- Companion contracts repinned byte-for-byte to upstream `e0bfa98611138512f916be9cf10f5395b78c10ed`.
- `docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md` now records V1 Full / Read-only / Unsupported support by feature/object, owner, contract/vector, test/gate, platform and limitation.
- BRAT install docs no longer pin stale `0.1.0-beta.1` or `feature/companion-v1-beta`.
- README and beta runbook link the V1 capability matrix.
- Architecture gate permanently checks C4 docs/matrix freshness and no-secret OAuth release docs.
Tracker updates:
- C4 docs/capability matrix final marked closed.
Still open:
- D1 E2E app <-> Drive <-> Obsidian.
- D2 feature-specific E2E.
- D3 BRAT clean install.
- D4 BRAT update.
- D5 Release Preflight.
- D6 Release Candidate.
- D7 feature freeze.
- D8 V1.
Next:
- Push this closeout docs commit to main.
- Add issue #45 progress comment for C4.
- Start D1 from updated main unless redirected.

## 2026-09-22 - D1 Android -> Drive -> Companion projection checkpoint

Repo: Companion (`C:\Users\lauri\Documents\companion`)
Branch: `codex/d1-task-end-date-schedule`
Base HEAD: `eca714e9b6a58db153db5045b0810e146569f7e3`
Upstream app HEAD: `e0bfa98611138512f916be9cf10f5395b78c10ed`

Real D1 object created on Android:
- Title: `Prepare campaign`
- ID: `945edb91-f00b-469e-beca-586e6dd968d3`
- Android local path: `/storage/emulated/0/Documents/garden/tasks/prepare-campaign.md`
- Pulled evidence: `C:\Users\lauri\Documents\companion\prepare-campaign.android.md`
- Schedule: `end_date: "2026-09-23T00:00:00.000"`, `all_day: false`, `scheduled_time: "10:00"`, `duration: 15`
- Reminders: auto popup at `2026-09-23T10:00:00.000`; manual popup `days_before: 0`, `time_of_day: "09:45"`

Android sync finding:
- Normal manual sync refused automatic publish with log: `Adoption required for unpaired local file tasks/prepare-campaign.md; refusing automatic publish.`
- Used Quartzo Settings -> Sync & Backup -> `Adopt Local-Only Files`.
- Because an existing full sync was processing many pre-existing `social/...` conflicts, Auto-Sync was temporarily turned off and the app was restarted so adoption could run as a single explicit sync.
- Adoption log confirmed: `[SyncManager] Adopted local-only file tasks/prepare-campaign.md.`
- Android `sync_actions` no longer contains object `945edb91-f00b-469e-beca-586e6dd968d3`.
- Android `file_sync_state` contains `tasks/prepare-campaign.md` with matching local/remote/base hash `c1e9dedf7a2d532ff9c9f171f187bc9358824ba493452b7614e39d7c1a90c022` and remote file id `1xo1KH9l34H2faX5OYaBzyb-K8WTpxFGt`.

Drive/local vault evidence:
- File arrived at `C:\Users\lauri\My Drive (obslauri@gmail.com)\os\tasks\prepare-campaign.md`.
- `rg` found the D1 title/id in that vault file.

Companion bug discovered and fixed:
- The real Quartzo Android Task used `end_date` for the scheduled date.
- Companion `DailyScheduleEngine.processTask()` only consumed `start_date` / `scheduler.start_date`, so the Task would not appear in Home/Planner/Day Dial despite being present in the vault.
- Fixed Daily Schedule to fall back to `end_date` for one-off app-created Tasks and to explicitly set timed Tasks as `isAllDay: false`.
- Added regression for app-created Tasks with `end_date + scheduled_time`.
- Added Reminder regression for app-created Task reminders with `end_date + scheduled_time + days_before/time_of_day`.

Changed:
- `src/core/daily_schedule/engine.ts`
- `tests/contracts/daily_schedule.test.ts`
- `tests/core/reminder-projection.test.ts`
- `docs/v1/CODEX_V1_PROGRESS.md`

Companion install/update:
- Built with `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID=986854614882-2bhoeca0ph278pibfm3nmhqjp6nue6km.apps.googleusercontent.com`.
- Copied release artifact into `C:\Users\lauri\My Drive (obslauri@gmail.com)\os\.obsidian\plugins\quartzo-obsidian-companion`.
- Preserved `data.json` and `quartzo-sync-state.json`.
- Restarted Obsidian and reopened vault `os`; workspace has `quartzo-view`.

Tests run:
- `npx vitest run tests/contracts/daily_schedule.test.ts tests/core/reminder-projection.test.ts tests/ui/day-dial-projection.test.ts tests/ui/home-projection.test.ts` - green, 48 tests.
- `npm run typecheck` - green.
- `npm run architecture:check` - green.
- `npm run build` with production Client ID - green.
- `npm run release:validate` - green.
- `npm run smoke:clean-artifact` - green.
- `npm test` - green, 600 tests.
- `npm run test:contracts` - green, 260 tests.

Still open:
- Android Auto-Sync was turned off during isolation and should be restored after the D1 sync/conflict state is under control.
- Android sync has 45 pre-existing `sync_conflicts` from older vault files, unrelated to `Prepare campaign`.
- Companion `data.json` still has `isPaired: false`; local vault projections work, but Drive sync from Companion remains unpaired/manual until pairing is confirmed.
- Codex cannot visually inspect/click the Obsidian DOM in this session. Need user/UI confirmation for Home/Planner/Day Dial and Done click, or another accessible control surface.

Exact next action:
1. In Obsidian Companion, confirm `Prepare campaign` appears on 2026-09-23 in Home/Planner at `10:00` and Day Dial as a marker.
2. Click `Done` for that occurrence in Companion.
3. Re-enable Android Auto-Sync or run explicit sync after the Done mutation.
4. Verify Android shows the Task completed, Planner/Day Dial agree, no duplicate `Prepare campaign`, and no new conflict for `tasks/prepare-campaign.md`.

## 2026-09-22 - D1 Companion projection fix merged

Repo: Companion (`C:\Users\lauri\Documents\companion`)
Branch: `main`
PR: https://github.com/olalaurao/quartzo-obsidian-companion/pull/58
PR head SHA: `bfa53544f544cb3ced7ef6b693076a3895d0905f`
Merge SHA: `fa889f1564f1d2be9299025756322bb26b2be191`
Remote CI run: `35736427247`

Remote CI result:
- `test-linux` - success.
- `test-windows` - success.
- `test-macos` - success.

Status:
- PR #58 merged the D1 Companion fix for app-created one-off Tasks that use `end_date + scheduled_time`.
- Local `main` is fast-forwarded to `origin/main`.
- The Obsidian vault plugin bundle was already rebuilt from this fix, copied into `C:\Users\lauri\My Drive (obslauri@gmail.com)\os\.obsidian\plugins\quartzo-obsidian-companion`, and Obsidian was restarted with vault `os` reopened.

Still open:
- Need visual/user confirmation that Companion shows `Prepare campaign` on 2026-09-23 at `10:00` in Home/Planner and as a Day Dial marker.
- Need the actual Companion `Done` click for that occurrence, then Android sync verification.
- Android Auto-Sync is still off from the isolated adoption run and should be restored after the Done mutation is ready to sync.
- Android has 45 pre-existing conflicts from older vault files; these remain unrelated to `tasks/prepare-campaign.md` unless a new conflict appears for that path.

Exact next action:
1. User or an accessible Obsidian control surface clicks `Done` for `Prepare campaign` in Companion.
2. Codex re-enables/runs Android sync.
3. Codex verifies Android completion state, no duplicate `Prepare campaign`, and no new conflict for `tasks/prepare-campaign.md`.
