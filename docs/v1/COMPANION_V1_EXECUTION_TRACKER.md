# Companion V1 Execution Tracker

> **Status-only / execution tracker.**
>
> Este arquivo existe para não perder o estado do caminho até a V1 entre sessões, agentes e PRs. Ele **não é fonte canônica de regra de produto ou arquitetura**.
>
> Autoridade continua sendo:
> 1. pedido atual;
> 2. spec ativa aplicável;
> 3. Quartzo `guidelines.md`;
> 4. Quartzo `agents.md`;
> 5. contratos upstream em `contracts/quartzo/`;
> 6. Companion `guidelines.md` / `agents.md`;
> 7. owners canônicos existentes.
>
> Quando este tracker descobrir uma regra permanente nova, a regra deve ser promovida ao documento/contract canônico correspondente no mesmo milestone.

Última atualização operacional: **2026-09-21**.

---

## Linha de chegada V1

A V1 só é considerada pronta quando todos os quatro marcos abaixo estiverem concluídos com evidência.

### Marco A — fronteira Quartzo ↔ Companion
- [x] Sync trigger coalescing upstream.
- [x] Companion repinado após correção de sync.
- [x] Occurrence Reschedule contract upstream.
- [x] Reschedule implementado e vendorado no Companion.
- [x] A4 System/Routine manual execution contract upstream.
- [x] A4 Companion manual Run / Routine execution.
- [x] **A5 Focus/Pomodoro runtime contract upstream.**
- [x] **A5 Companion Focus/Pomodoro runtime.**
- [x] **A6 conclusão cross-client de ocorrência agendada de System.**
- [x] **A7 Overdue + Adaptive Essentials/Capacity boundary.**

### Marco B — comportamento restante da V1
- [x] System manual Run no Companion.
- [x] Routine manual execution no Companion.
- [x] Focus/Pomodoro parity.
- [x] Home/Planner/Dial/Detail/Search/Browse/Journal polish final.
- [x] Reminder/Calendar edge-case closure.
- [x] Sync Center diagnostics finais sem reescrever o sync.

### Marco C — qualidade/release gates
- [x] UI/UX + accessibility pass.
- [x] performance/lifecycle/race pass.
- [x] pending-sync path + reason diagnostics.
- [x] macOS CI.
- [x] OAuth contract/runtime/release divergence.
- [x] docs/capability matrix final.

### Marco D — prova e release
- [ ] E2E app ↔ Drive ↔ Obsidian.
- [ ] BRAT clean install.
- [ ] BRAT update sobre instalação existente.
- [ ] Release Candidate.
- [ ] feature freeze.
- [ ] blocker-only fixes.
- [ ] **V1.**

---

## Estado certificado atual

### A4 — System/Routine manual execution
**Status: ✅ fechado.**

Upstream Quartzo:
- PR #42.
- final head certificado: `cfb05278`.
- merge canônico: `6aa6fd1787a147c7598bf98cb4473ea2b5fb9cdd`.
- Flutter Analyze: verde.
- Flutter Test: verde.
- Dial Focus CI: verde.
- Agent Contract Gate: verde.

Companion:
- PR #46.
- final head certificado: `c50e3853`.
- merge canônico: `574904eee7d734c4d2e22f26df6825efffc186c7`.
- Linux CI: verde.
- Windows CI: verde.
- contracts verify / typecheck / lint / full tests / contract vectors / sync regression / architecture check / build / release validation / package: verdes.

Resultado:
- System Run e Routine execution usam contrato vendorizado.
- whole-run preflight é fail-closed.
- linked owners permanecem canônicos.
- System evidence + summary Task são retry-safe.
- Routine progress é occurrence-scoped.
- Pomodoro continua `requiresFocusRuntime` até A5.
- Run continua separado de Done/Already did.

---

## Milestone ativo — A5 Focus/Pomodoro runtime

**Status: ✅ A5 fechado upstream + Companion. Quartzo `a8ec975c`; Companion PR #47 → `16c2b616`.**

### A5.1 — owner e persistência atuais
- [x] Confirmar que existe um único Focus/Pomodoro runtime no Quartzo.
- [x] Confirmar que `PomodoroNotifier` é o owner de runtime atual.
- [x] Confirmar que transição de work/short break/long break pertence a `PomodoroPhaseEngine`.
- [x] Confirmar que timer é timestamp/state-based, não contador de UI.
- [x] Confirmar runtime persistido em `sessions/current.md`.
- [x] Confirmar histórico/evidence persistido como `PomodoroSession`.
- [x] Confirmar que preset ativo é persistido via `selectedPresetId` + `preset_snapshot`; não criar segundo sync de presets.
- [x] Confirmar estados relevantes: scheduled / active / paused / completed / partial / cancelled.
- [x] Confirmar modos: pomodoro / stopwatch.
- [x] Confirmar phases: work / shortBreak / longBreak / custom / stopwatch.

### A5.2 — integração com Checklist/System/Routine
- [x] Identificar identidade estável de checklist Pomodoro:
  `checklist:<parentObjectId>:<stepId>`.
- [x] Confirmar que sessão `completed` nessa data + `linked_item_slug` é evidence de conclusão do step.
- [x] Contratar explicitamente que `partial` **não** marca checklist Pomodoro como concluído.
- [x] Adicionar vectors cross-client para identidade/evidence de checklist Pomodoro.
- [x] Depois do runtime Companion, alterar manual execution capability de Pomodoro de `requiresFocusRuntime` para `supported`.

### A5.3 — multi-client ownership / takeover
Descoberta nova:
- `sessions/current.md` é compartilhado, mas hoje não persiste quem controla a sessão.
- não existe no Flutter um client/device ID canônico reutilizável.
- o contrato Companion já proíbe takeover simultâneo silencioso.

Plano:
- [x] definir `focusControllerId` como identidade **device-local**;
- [x] gerar/persistir o ID por instalação no `SettingsNotifier`, sem colocar credencial/segredo em shared settings;
- [x] enquanto a sessão estiver ativa/paused, persistir `focusControllerId` em `sessions/current.md`;
- [x] cliente cujo ID não seja o controller observa a sessão como read-only;
- [x] takeover explícito fica fora de V1 até existir protocolo próprio;
- [x] sessão idle não mantém claim de controller; nova sessão pode ser iniciada sem takeover;
- [x] vectors provam owner match / foreign owner / legacy state sem controller;
- [x] contratar colisão offline como conflito three-way de `sessions/current.md`, sem promessa de lease distribuído;
- [x] decidir comportamento seguro para `sessions/current.md` legado sem controller ID: Companion observa read-only; Quartzo mobile atualizado pode fazer o claim de migração porque o Companion pré-A5 não tinha runtime capaz de originar esse estado.
- [x] contratar essa regra em vectors e testes.

### A5.4 — contrato upstream
- [x] criar `contracts/quartzo/focus_runtime/vectors.json`;
- [x] adicionar `focusRuntimeContractVersion: 1.0.0` ao manifest;
- [x] documentar Focus Runtime V1 no Companion contract upstream;
- [x] atualizar `contracts/quartzo/README.md`;
- [x] criar runner Dart executável dos vectors;
- [x] incluir vectors no contract fixture gate geral;
- [x] adicionar architecture gate para owner/persistência/controller;
- [x] atualizar `guidelines.md` com ownership cross-client;
- [x] atualizar `agents.md` com owner e boundary de takeover;
- [x] manter `PomodoroNotifier` como runtime owner; não criar provider/runtime paralelo.

### A5.5 — Quartzo implementation alignment
- [x] extrair somente `FocusRuntimeContract` puro; `PomodoroNotifier` continua runtime owner;
- [x] persistir controller ID no current state ativo/paused;
- [x] preservar leitura de `sessions/current.md` legado com migration claim Quartzo/read-only Companion;
- [x] garantir pause/resume/finish/cancel através do mesmo `PomodoroNotifier` + control gate;
- [x] projetar foreign active runtime como read-only também na UI Quartzo;
- [x] bloquear start de Focus estrangeiro também no `RuntimeInteractionDispatcher`;
- [x] garantir fase/duração derivadas do preset snapshot persistido;
- [x] garantir que reopen/reload recalcule por timestamps;
- [x] confirmar completion evidence `PomodoroSession`;
- [x] confirmar partial/cancelled semantics;
- [x] testar checklist linked evidence;
- [x] flutter analyze — verde no head `222ac11a`;
- [x] testes relevantes — Flutter Test ✅ no head `222ac11a`;
- [x] architecture/compliance gates — Agent Contract Gate ✅ no head `222ac11a`;
- [x] CI final — Analyze ✅, Flutter Test ✅, Dial Focus CI ✅, Agent Contract Gate ✅;
- [x] merge upstream — PR #44 → `a8ec975c`.

### A5.6 — Companion implementation
Upstream fechado: Quartzo PR #44 → merge canônico `a8ec975c`. Implementação downstream em `contracts/companion-focus-runtime-v1`; itens abaixo só viram concluídos após gates/CI quando aplicável:
#### Mapeamento de owners/arquivos já concluído
- `src/main.ts`: composition root; adicionar controller ID device-local em `QuartzoCompanionSettings`, inicializar Focus repository/runtime e expor callbacks para UI/manual execution.
- `loadSettings()/saveSettings()`: owner local canônico do `focusControllerId`; não colocar o ID em shared settings/vault.
- novo `src/core/focus-runtime/*`: somente policy/codec/timer/phase semantics puras a partir dos vectors vendorizados; sem segundo store.
- novo `src/vault/focus-runtime.ts`: único adapter de `sessions/current.md`, usando `Vault.process()` para mutações owner-only e preservando campos desconhecidos.
- `registerVaultEvents()`: tratar create/modify/delete/rename de `sessions/current.md` como reload do mesmo runtime; não criar watcher paralelo.
- `src/core/manual-execution/policy.ts`: manter policy única e passar `focusRuntimeAvailable: true` quando o owner estiver inicializado.
- `completeLinkedManualExecutionStep()`: Pomodoro deve abrir/iniciar o Focus owner com linked ID `checklist:<parent>:<step>`; Habit/Task/Tracker continuam nos owners atuais.
- `manualExecutionLinkedStates()`: completion continua resolvida por evidence `PomodoroSession.completed`, nunca por estado transitório do timer.
- `src/ui/shell/view.ts` + Home/Planner: apenas projetar snapshot/callbacks do mesmo runtime.
- UI Focus V1: preferir pane/section compacta no Quartzo view; nada de overlay Pomodoro independente.
- foreign/legacy active controller: timer visível por timestamp, todos os controles mutáveis disabled/read-only.
- colisão offline: deixar `sessions/current.md` no sync three-way normal; não auto-merge nem takeover.

- [x] repin/vendoring no SHA canônico `a8ec975c` — bytes + SHA-256 verificados;
- Implementado no branch, aguardando certificação: core puro + lifecycle, `FocusRuntimeRepository`, evidence em daily note, `focusControllerId` device-local, Vault-event reload, header/modal, foreign/legacy read-only, checklist identity/evidence e integração System/Routine.
- [x] implementar core puro a partir dos vectors;
- [x] implementar Vault adapter único para `sessions/current.md`;
- [x] implementar leitura/escrita de `PomodoroSession` sem source of truth paralelo;
- [x] usar timestamp state para renderização;
- [x] Home/Planner/Quick Add/header podem projetar o mesmo runtime — header/Quartzo shell usam o owner único; sem runtime paralelo;
- [x] compact Focus surface dentro do Quartzo + inline em manual execution; overlay Focus independente removido;
- [x] pause/resume/finish/cancel somente se Companion for controller;
- [x] foreign active controller = read-only;
- [x] link de checklist usa `checklist:<parent>:<step>`;
- [x] liberar Pomodoro no manual-execution preflight;
- [x] validar System/Routine com step Pomodoro end-to-end — completed fecha; partial não fecha;
- [x] Linux CI — verde no head `4a764303`;
- [x] Windows CI — verde no head `4a764303`;
- [x] contracts verify;
- [x] typecheck;
- [x] lint;
- [x] full tests — 551/551 no head certificado;
- [x] architecture check;
- [x] build/release validation + clean-artifact/package;
- [x] merge Companion — PR #47 → `16c2b616cd6dfe4983007a087f08a6adbdccf7b6`.

---

## Certificação A5 Companion

- [x] contratos repinados byte-for-byte no upstream `a8ec975c055d44a97ab8cbe1799f47c455b857f7`;
- [x] PR #47 final head certificado: `4a764303005429d078a9fd6e100e0f768069b0aa`;
- [x] Linux CI: verde;
- [x] Windows CI: verde;
- [x] audit production dependencies: verde;
- [x] contracts verify: verde;
- [x] typecheck + lint: verdes;
- [x] full tests: 551/551 verdes;
- [x] contract tests + sync regressions: verdes;
- [x] architecture check: verde, incluindo single-owner Focus / no independent overlay;
- [x] build + release validate + clean artifact + package: verdes;
- [x] merge canônico Companion: `16c2b616cd6dfe4983007a087f08a6adbdccf7b6`.

---

## Incidentes de certificação A5

- [x] Head `fc388f0a`: Agent preflight passou, mas `architecture_gate_test.dart` não compilou porque o assertion de identidade checklist usava uma string Dart interpolada (`$parentObjectId/$stepId`) em vez de literal raw.
- [x] Corrigido em `222ac11a` com assertion raw; nenhuma regra de produto/runtime foi alterada por esse fix.
- [x] Certificar o head `222ac11a`: Analyze ✅; Flutter Test ✅; Dial Focus CI ✅; Agent Contract Gate ✅.

## Milestone fechado — A6 conclusão de ocorrência agendada de System

**Status: ✅ fechado upstream + Companion. Quartzo `9f11f92a`; Companion PR #48 → `635ff280`.**

Upstream Quartzo:
- [x] PR #45 certificado no head `fc7f93d1caecfa2d0d49f01d696e9a88a78186ff`.
- [x] Flutter CI, Dial Focus CI e Agent Contract Gate verdes no mesmo head.
- [x] merge canônico: `9f11f92a3008b5b14d88c8febf46a67b186efe24`.
- [x] `systemRoutineExecutionContractVersion = 1.1.0`.
- [x] Finish evidence é o único owner de conclusão positiva de System; Run manual não fecha occurrence.
- [x] `occurrence_id` permanece estável em Reschedule; `scheduled_for` é contexto temporal.
- [x] System agendado expõe Run + Skip e não expõe Done/Already did.

Companion:
- [x] branch `contracts/system-scheduled-occurrence-v1` criado a partir de `aaab6c7a4aa7806f4f6264516e69ddbef11de109`.
- [x] repin byte-for-byte contra o merge SHA upstream, somente nas quatro fontes declaradas alteradas.
- [x] evidence pareada, retry fail-closed, projeção exata no Daily Schedule e policy Run + Skip portados.
- [x] regressões para manual same-day, linked exact, half-pair e reschedule cross-day.
- [x] PR #48 final head certificado: `52e5df905c241fffe0f11776f416767f7362e3e2`.
- [x] CI #667 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #667 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `635ff28071587de61d8ed71c31d90a1657c39cb6`.

---

## Milestone fechado — A7 Overdue + Adaptive Essentials/Capacity

**Status: ✅ fechado upstream + Companion. Quartzo `d9302f08`; Companion PR #49 → `bbd285f`.**

Upstream Quartzo:
- [x] PR #47 certificado no head `98076a65f9aab11f9e307d5553432d442bc60255`.
- [x] Agent Contract Gate, Dial Focus CI e Flutter CI verdes no mesmo head.
- [x] merge canônico: `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- [x] `dailyScheduleContractVersion = 1.1.0`.
- [x] `overdueProjectionContractVersion = 1.0.0`.
- [x] `adaptivePlanningContractVersion = 1.0.0`.
- [x] Daily Schedule deixa de carregar Reminder vencido como item normal de hoje.
- [x] Overdue é projeção separada, só por deadline/due real.
- [x] DailyPlanningState carrega exact essential/parked IDs e `capacity_mode`; numeric capacity não é persistido/compartilhado.

Companion:
- [x] branch `codex/a7-overdue-adaptive-planning`.
- [x] repin byte-for-byte contra o merge SHA upstream `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- [x] `SharedPlanningStateRepository` permanece o único owner de `sessions/shared_planning_state_v1.md`.
- [x] Adaptive consome exact essential/parked IDs, remove completed essentials da projeção visível e mantém numeric capacity `null`.
- [x] Overdue core puro único consumido por Home e Journal.
- [x] Home/Journal mantêm Overdue separado de `today`.
- [x] PR #49 final head certificado: `7776ad7b274ecf5d2c733aaf8b0b9c051ab79128`.
- [x] CI #35674749253 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35674749253 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `bbd285f1b94ddbfd6ab44fb17254d12ca3198209`.

Tracker reconciliation:
- [x] Focus/Pomodoro parity checkbox reconciled as closed by certified A5 (`a8ec975c` upstream, `16c2b616` Companion). No Focus reimplementation was done for A7.

---

## Milestone fechado — B1 surface acceptance/polish

**Status: ✅ fechado no Companion. PR #50 → `c6ea577`.**

Companion:
- [x] Branch `codex/b1-surface-acceptance-polish`.
- [x] Home Quick Actions expõe todos os Quick Add suportados pelo core: Task, Entry, Note, Reminder, Record e Resource.
- [x] Quick Add contract prova roundtrip de Task/Entry/Note/Reminder/Record/Resource sem ampliar mutation support por heurística.
- [x] Home/Planner/Day Dial/Detail/Search/Browse/Journal auditados contra o B1 handoff e UI spec; gaps restantes foram classificados fora de B1.
- [x] `UPSTREAM.lock.json` repinado no mesmo SHA A7 `d9302f0860fa1a4e33c1c611f2b448bec167e51f` depois de `contracts:verify` expor manifest stale; contratos continuam byte-for-byte.
- [x] PR #50 final head certificado: `4eea8a27684b576e52099281de5962f73c653f70`.
- [x] CI #35675821273 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35675821273 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `c6ea5773a261a73b65bb085970054c154c443234`.

---

## Milestone fechado — B2 Reminder/Calendar edge-case closure

**Status: ✅ fechado no Companion. PR #51 → `6e340fe`.**

Companion:
- [x] Branch `codex/b2-reminder-calendar-edge-closure`.
- [x] Reminder `minutes_before` cobrindo trigger no dia local anterior.
- [x] Reminder delivery preserva `escalation_level` válido e `notification_body`.
- [x] `dismissDelivery` passa pelo owner canônico de occurrence action, idempotente por `actionId`, sem incrementar `ignoredCount` em replay.
- [x] Google Calendar cobre paginação de calendar list e paginação de eventos por calendário.
- [x] Google Calendar propaga erros API/network não-autorização para a camada chamadora tratar fail-closed.
- [x] PR #51 final head certificado: `f85cbf782c61bce67a10f1f8ad7e14473e62ffe0`.
- [x] CI #35676498790 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35676498790 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `6e340fed9380820f768baa089dd2aa5547a5220f`.

---

## Milestone fechado — B3 Sync Center diagnostics

**Status: ✅ fechado no Companion. PR #52 → `7598ec7`.**

Companion:
- [x] Branch `codex/b3-sync-center-diagnostics`.
- [x] `SyncStatusSnapshot` expõe `pendingDiagnostics` tipado, derivado pelo `DriveSyncCoordinator`.
- [x] `pendingLocalChanges` é derivado da lista de diagnostics, preservando a projeção read-only do coordinator.
- [x] Razões cobertas por fontes reais do motor: local create, local modify, pending delete, pending rename, adoption required, conflict e quarantined duplicate identity.
- [x] Sync Center mostra lista path/reason e permite copiar o diagnóstico, preservando status, last sync, vault, account, version, conflicts e last error.
- [x] Sem segunda sync queue, sem novo reconciliation engine, sem persistência canônica nova e sem inferência de reason por texto de erro na UI.
- [x] PR #52 final head certificado: `68453db5f0143fa5cb50c285721c81cac200a08c`.
- [x] CI #35677272561 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35677272561 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `7598ec7d7df86537447eb329b25567a93e1567a5`.

---

## Milestone fechado — C1 UI/UX + accessibility pass

**Status: ✅ fechado no Companion. PR #53 → `49ba27c`.**

Companion:
- [x] Branch `codex/c1-ui-accessibility-pass`.
- [x] Shell navigation/actions expõem current/pressed state.
- [x] Planner e Journal têm accessible names em setas e inputs de data.
- [x] Browse/Search e Quick Add têm labels programáticos em inputs/selects.
- [x] Loading, warning, Sync summary, last error, progress e metadata status usam status/alert/live-region.
- [x] Controles disabled de sync/pairing explicam por que estão indisponíveis.
- [x] Day Dial expõe Done/Skipped em labels acessíveis e texto visível de legend/chips, não só cor/opacidade.
- [x] CSS adiciona foco visível de teclado e quebra de texto longo em diagnostics/errors/conflicts.
- [x] PR #53 final head certificado: `82ec36acaa19a5e16c3bf26fe21905dad32f7b14`.
- [x] CI #35677969176 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35677969176 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `49ba27c6784e4732804d7eceacf7214996680532`.

---

## Milestone fechado — C2 performance/lifecycle/race pass

**Status: ✅ fechado no Companion. PR #54 → `6ccb085`.**

Companion:
- [x] Branch `codex/c2-lifecycle-race-hardening`.
- [x] Renderizações Home/Planner/Journal/Sync usam generation token para descartar callbacks assíncronos stale antes de mutar UI antiga/desconectada.
- [x] Planner captura date/mode/lens por render; Week/Month continuam buscando Calendar uma vez por range, sem fetch por item.
- [x] Sync Center guarda progress/final render contra callbacks stale.
- [x] Unload bloqueia mutações tardias de Calendar/OAuth/Vault index/Drive watcher/shared-state callbacks e preserva `oauthClient.abort()`.
- [x] VaultIndex inicial segue único após workspace layout readiness; create/modify/delete/rename permanecem incrementais.
- [x] Shared settings serializa reload/reindex: uma execução ativa e no máximo um rerun solicitado por eventos concorrentes.
- [x] Architecture gate cobre permanentemente lifecycle/race guards e coalescing de shared settings.
- [x] Sem alteração de protocolo sync, cache canônico novo, segundo index owner ou mutação Calendar.
- [x] PR #54 final head certificado: `bdd4ec3147ce13ab589ce504aad0805cb6742c4d`.
- [x] CI #35679013301 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35679013301 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] merge canônico Companion: `6ccb085aaf3cfe5331ca05ac47e56ef7c480b825`.

---

## Milestone fechado — C3 macOS CI

**Status: ✅ fechado no Companion. PR #55 → `49b27e0`.**

Companion:
- [x] Branch `codex/c3-macos-ci-release-gates`.
- [x] CI principal agora inclui `test-macos` em `macos-latest`.
- [x] macOS roda npm install, production audit, contracts verify, typecheck, lint, full tests, contract tests, sync tests, architecture check, build, release validate, clean artifact smoke e package.
- [x] Architecture gate exige macOS CI parity e audit gate canônico nos três sistemas.
- [x] Contract test cobre a presença dos gates macOS no workflow.
- [x] Release/preflight OAuth behavior permaneceu intocado; divergência OAuth continua classificada como C3.5.
- [x] PR #55 final head certificado: `3a6e2f3a45b6a185b86f344c13e7c49586420128`.
- [x] CI #35679476172 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35679476172 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] CI #35679476172 macOS: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] merge canônico Companion: `49b27e02878ae1f2c5348ebefd845d989e0f5d7f`.

---

## Milestone fechado — C3.5 OAuth contract/runtime/release divergence

**Status: ✅ fechado no Companion. PR #56 → `5c96485`.**

Companion:
- [x] Branch `codex/c35-oauth-no-client-secret`.
- [x] Upstream Quartzo app verificado em `C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`.
- [x] Upstream main verificado no SHA canônico `d9302f0860fa1a4e33c1c611f2b448bec167e51f`.
- [x] Contrato vendorizado já dizia que o Desktop OAuth client não deve conter client secret; não houve patch upstream necessário.
- [x] Runtime OAuth usa Client ID + loopback `127.0.0.1` + PKCE, sem enviar `client_secret` no authorization-code exchange ou refresh-token exchange.
- [x] `SecretStorage` guarda somente refresh token; Client Secret removido de IDs, Settings UI e configuração OAuth.
- [x] Release/preflight exigem somente `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID`.
- [x] `release:validate` rejeita artefato que contenha `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET`.
- [x] Architecture gate e regressões cobrem ausência de secret em runtime, workflows e SecretStorage.
- [x] README, runbook beta e OAuth setup documentam o fluxo sem Client Secret.
- [x] PR #56 final head certificado: `9b912ca2b0f91e742313e82cf545e8d8bd399d9a`.
- [x] CI #35680269632 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35680269632 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] CI #35680269632 macOS: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] merge canônico Companion: `5c96485a91be1a20243dce32f38fbcaa89ac2f2b`.

---

## Milestone fechado — C4 docs/capability matrix final

**Status: ✅ fechado upstream + Companion. Quartzo `e0bfa986`; Companion PR #57 → `cd4acf3`.**

Upstream Quartzo:
- [x] PR #48 certificado no head `6abb27dd235a0d493a2d5df29b8f506d7a2bc4f9`.
- [x] Agent Contract Gate verde.
- [x] Flutter CI Analyze verde.
- [x] Flutter CI Test verde.
- [x] merge canônico: `e0bfa98611138512f916be9cf10f5395b78c10ed`.
- [x] `P0_COMPLIANCE_MATRIX.md` usa paths literais portáveis, removendo link vendorizado quebrado para `.agents/AGENTS.md`.

Companion:
- [x] Branch `codex/c4-v1-docs-capability-matrix`.
- [x] repin byte-for-byte contra upstream `e0bfa98611138512f916be9cf10f5395b78c10ed`.
- [x] `docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md` criado com status Full / Read-only / Unsupported, owner, contrato/vector, teste/gate, plataforma e limitações V1.
- [x] `docs/INSTALL_BRAT.md` deixou de fixar `0.1.0-beta.1` e `feature/companion-v1-beta`; instalação passa a apontar para prerelease validada.
- [x] README e runbook beta linkam a matriz de capacidade final.
- [x] Architecture gate cobre matriz C4, docs BRAT sem texto stale, P0 vendorizado sem link quebrado e fronteira OAuth sem Client Secret.
- [x] PR #57 final head certificado: `8c7802c0515413d11cd1c696b2cac37c611e888a`.
- [x] CI #35682290980 Linux: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] CI #35682290980 Windows: audit, typecheck, sync regression, build, clean artifact e package verdes.
- [x] CI #35682290980 macOS: audit, contracts verify, typecheck, lint, full tests, contract vectors, sync regressions, architecture check, build, release validate, clean artifact e package verdes.
- [x] merge canônico Companion: `cd4acf3926b880f62b8da1c15f96e3fef356ae1c`.

---

## Descobertas / scope growth log

Adicionar aqui qualquer coisa nova encontrada durante implementação. Não expandir automaticamente o milestone atual; primeiro classificar.

| Data | Descoberta | Classificação | Milestone/owner |
|---|---|---|---|
| 2026-09-21 | Daily Schedule do Quartzo não deriva atualmente `isCompleted` de `SystemExecution` para ocorrência agendada de System. | gap real; não resolver tratando Run como Done | Marco A, pós-A5/boundary |
| 2026-09-21 | `sessions/current.md` não identifica controller cross-client. | blocker arquitetural A5 | A5 |
| 2026-09-21 | Não existe client/device ID canônico reutilizável no Flutter. | nova decisão necessária | A5 |
| 2026-09-21 | preset snapshot já viaja dentro do current-state; não é necessário sincronizar lista de presets para continuar sessão. | redução de escopo | A5 |
| 2026-09-21 | checklist Pomodoro usa `checklist:<parentId>:<stepId>`. | contrato cross-client necessário | A5 |
| 2026-09-21 | Legacy active `sessions/current.md` sem controller só pode ter vindo de runtime Quartzo pré-A5; Companion pré-A5 não criava Focus. | permite migração assimétrica segura: Quartzo claim, Companion read-only | A5 |
| 2026-09-21 | Provider-level foreign Focus blocking alone is insufficient: mutation controls must visibly project read-only state instead of remaining tappable and failing. | permanent UX/integration invariant; architecture-gated | A5 |
| 2026-09-21 | `focusControllerId` é claim observada, não lease distribuído. Dois clientes offline podem iniciar do mesmo idle antes de ver a claim alheia. | V1 deve deixar `sessions/current.md` cair no conflito three-way normal; nunca auto-merge/takeover | A5 / sync boundary |
| 2026-09-21 | Runtime actions/notifications também podem iniciar Focus, então read-only não pode ser tratado só na PomodoroScreen. | `RuntimeInteractionDispatcher` deve consultar o mesmo owner canônico e abrir a tela read-only sem mutar | A5 |
| 2026-09-21 | Overdue não pode ser misturado no Daily Schedule de hoje; Reminder vencido fica fora do snapshot date-canonical e entra apenas na projeção Overdue separada. | contrato cross-client certificado | A7 |
| 2026-09-21 | DailyPlanningState é o único owner de Essentials/Parked/capacity mode no Companion; numeric capacity segue indisponível no V1. | contrato cross-client certificado | A7 |

---

## Parking lot — não inflar milestone atual

Itens reais, mas que não devem entrar no PR corrente sem necessidade de correctness:

- full public multi-client focus takeover protocol;
- background auto-run de Systems/Routines;
- series-wide / thisAndFuture Reschedule;
- garantias de timer quando Obsidian está fechado;
- UI polish não relacionada ao correctness do milestone atual.

---

## Regra de atualização deste tracker

A cada milestone/PR:
1. atualizar estado e SHA/PR;
2. marcar apenas itens comprovados por teste/CI/E2E;
3. registrar descobertas novas;
4. promover regras permanentes para contracts/`guidelines.md`/`agents.md`;
5. não apagar gaps: mover para o milestone correto;
6. manter uma única linha de chegada até a V1.
