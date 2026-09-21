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
- [ ] **A5 Focus/Pomodoro runtime contract upstream.**
- [ ] **A5 Companion Focus/Pomodoro runtime.**
- [ ] Resolver semântica cross-client de conclusão de ocorrência agendada de System.
- [ ] Resolver/documentar boundary V1 de Overdue + Adaptive Essentials/Capacity.

### Marco B — comportamento restante da V1
- [x] System manual Run no Companion.
- [x] Routine manual execution no Companion.
- [ ] Focus/Pomodoro parity.
- [ ] Home/Planner/Dial/Detail/Search/Browse/Journal polish final.
- [ ] Reminder/Calendar edge-case closure.
- [ ] Sync Center diagnostics finais sem reescrever o sync.

### Marco C — qualidade/release gates
- [ ] UI/UX + accessibility pass.
- [ ] performance/lifecycle/race pass.
- [ ] pending-sync path + reason diagnostics.
- [ ] macOS CI.
- [ ] docs/capability matrix final.

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

**Status: 🟡 A5 upstream implementado no PR Quartzo #44; certificação no head `f602754f`.**

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
- [ ] Depois do runtime Companion, alterar manual execution capability de Pomodoro de `requiresFocusRuntime` para `supported`.

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
- [ ] flutter analyze;
- [ ] testes relevantes;
- [ ] architecture/compliance gates;
- [ ] CI final;
- [ ] merge upstream.

### A5.6 — Companion implementation
Somente após upstream A5 verde/mergeado. Upstream atual: Quartzo PR #44 (`212e922e`), CI pendente:
- [ ] repin/vendoring no SHA canônico;
- [ ] implementar core puro a partir dos vectors;
- [ ] implementar Vault adapter único para `sessions/current.md`;
- [ ] implementar leitura/escrita de `PomodoroSession` sem source of truth paralelo;
- [ ] usar timestamp state para renderização;
- [ ] Home/Planner/Quick Add/header podem projetar o mesmo runtime;
- [ ] optional compact timer pane, sem overlay Pomodoro independente;
- [ ] pause/resume/finish/cancel somente se Companion for controller;
- [ ] foreign active controller = read-only;
- [ ] link de checklist usa `checklist:<parent>:<step>`;
- [ ] liberar Pomodoro no manual-execution preflight;
- [ ] validar System/Routine com step Pomodoro end-to-end;
- [ ] Linux CI;
- [ ] Windows CI;
- [ ] contracts verify;
- [ ] typecheck;
- [ ] lint;
- [ ] full tests;
- [ ] architecture check;
- [ ] build/release validation;
- [ ] merge Companion.

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

---

## Parking lot — não inflar milestone atual

Itens reais, mas que não devem entrar no PR corrente sem necessidade de correctness:

- scheduled System occurrence completion projection;
- Overdue cross-client boundary;
- Adaptive Essentials / Capacity / parked-items boundary;
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
