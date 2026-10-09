# Companion agent-docs reconciliation ledger

Status: **SOURCE RULES INVENTORIED AND RELOCATED; FRESH-AGENT E2E NOT VERIFIED**  
Baseline main SHA `507f2ccfe2f991ea775e1f1aca5ca05e6f4c5218`.  
This document is audit evidence only. It does not replace `guidelines.md`, `agents.md`, `docs/specs/` or pinned upstream contracts.

## Conflict resolution and authority

- All **50** original numbered `guidelines.md` rules are preserved, even though three distinct topics reused 34–36. They have stable IDs `C-GUID-01` through `C-GUID-50` and theme headings; rules C-GUID-09 through C-GUID-23 were extracted verbatim into the local operational sync spec. A mechanical Node gate enforces one original rule per destination.
- No root `AGENTS.md` is created, to prevent case-only collision with root `agents.md`. `.github/copilot-instructions.md` is pointer-only. Automatic Codex discovery needs to be observed in a new session.
- Shared semantics remain defined by upstream Quartzo contracts, vendorized under `contracts/` and locked via `contracts/UPSTREAM.lock.json`. Local-first Drive transport and operational safeguards remain the Companion's responsibility. No alternate sync coordinator, object repository or auth owner was introduced.

## Rule-by-rule original → destination matrix

| Stable ID | Original numbered label | Category | Original obligation (excerpt) | Destination | Action | Validation |
|---|---|---|---|---|---|---|
| C-GUID-01 | 1 (line-level original ordering 1) | fundamentals | Fonte Canônica:** O repositório upstream `olalaurao/aplicativo` é a fonte canônica. Todas as regras de negócio e contratos de dados derivam  | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-02 | 2 (line-level original ordering 2) | fundamentals | Object Interop:** Objetos usam frontmatter YAML + Markdown body. Preserve chaves e campos desconhecidos. | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-03 | 3 (line-level original ordering 3) | fundamentals | Sem Caches Canônicos:** Não crie banco de dados SQLite secundário para dados canônicos. Índices locais são apenas projeções reconstruíveis. | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-04 | 4 (line-level original ordering 4) | fundamentals | Sem Ferramentas Externas:** O ambiente não deve exigir Node.js, Python ou daemons locais fora do Obsidian. | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-05 | 5 (line-level original ordering 5) | fundamentals | Typescript Rigoroso:** Utilize TypeScript Strict, sem type casting cego de objetos brutos. | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-06 | 6 (line-level original ordering 6) | sync/security | Sincronização:** Todas as ações de sincronização com o Google Drive devem utilizar "three-way reconciliation" baseado no baseline e nos hash | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-07 | 7 (line-level original ordering 7) | sync/security | Modo de sync:** O Companion expõe um único modo local de sincronização: `Manual` ou `Automatic`. `Manual` é o padrão e não pode disparar rec | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-08 | 8 (line-level original ordering 8) | sync/security | Companion local-first por padrão:** se o vault do Obsidian já está em Google Drive Desktop ou outra pasta sincronizada pelo sistema de arqui | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-09 | 9 (line-level original ordering 9) | sync/security | Limpeza de identidade ambígua no pairing:** o Companion só pode oferecer limpeza automática de candidatos duplicados após ação explícita do  | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-10 | 10 (line-level original ordering 10) | sync/security | Quota temporária do Drive:** pairing/sync explícitos não devem tratar limite temporário por minuto da API do Google Drive como falha de aute | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-11 | 11 (line-level original ordering 11) | sync/security | Progresso do primeiro pairing:** após `Accept & Pair`, a UI deve permanecer explicitamente ocupada até a operação terminar. O usuário precis | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-12 | 12 (line-level original ordering 12) | sync/security | Falha observável no primeiro pairing:** uma falha após `Accept & Pair` não pode fechar silenciosamente a superfície de pairing nem depender  | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-13 | 13 (line-level original ordering 13) | sync/security | Uma única superfície para o primeiro pairing:** diagnóstico de divergências/ambiguidades, confirmação de limpeza segura, progresso da limpez | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-14 | 14 (line-level original ordering 14) | sync/security | Pós-condição da limpeza de duplicados:** mover um candidato para a lixeira do Drive só conta como sucesso quando a API confirmar `trashed=tr | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-15 | 15 (line-level original ordering 15) | sync/security | Permissão de lixeira em duplicados do Drive:** o diagnóstico de candidatos ambíguos deve carregar `capabilities.canTrash`. O plano automátic | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-16 | 16 (line-level original ordering 16) | sync/security | Escopo canônico do vault é allow-list:** sync/pairing do Companion só considera `*.md`, `*.base`, `_attachments/**`, `_capture_ingress/**`,  | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-17 | 17 (line-level original ordering 17) | sync/security | Revalidação do primeiro pairing usa o estado atual seguro:** o resumo exibido continua sendo a confirmação do usuário, mas a aplicação não d | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-18 | 18 (line-level original ordering 18) | sync/security | Changes API não redefine lixeira como conteúdo vivo:** o feed incremental do Google Drive deve solicitar e propagar `file.trashed`. Um chang | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-19 | 19 (line-level original ordering 19) | sync/security | Owner incremental persistido deve ser revalidado antes de declarar ambiguidade:** quando o estado local guarda um `remoteFileId` para um cam | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-20 | 20 (line-level original ordering 20) | sync/security | Operações demoradas precisam ser observáveis:** qualquer operação iniciada pelo usuário que possa levar tempo perceptível (por exemplo pairi | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-21 | 21 (line-level original ordering 21) | sync/security | Duplicatas remotas também precisam de recuperação segura depois do pairing:** se `Sync now` ou full reconciliation detectar mais de um ID re | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-22 | 22 (line-level original ordering 22) | sync/security | Requests do Google Drive têm deadline finito:** nenhuma chamada de rede do adapter do Drive pode manter uma operação de sync/pairing ocupada | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-23 | 23 (line-level original ordering 23) | sync/security | Modo Manual também hidrata estado local no startup:** recarregar/atualizar o plugin não pode fazer o Sync Center esquecer temporariamente o  | `docs/specs/drive-sync-operational.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-24 | 24 (line-level original ordering 24) | daily/occurrence/Focus | Ações de ocorrência são estado compartilhado canônico, não mutação de tela:** `Done`, `Already did`, `Skip`, `Clear/Undo`, `Snooze` e `Dismi | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-25 | 25 (line-level original ordering 25) | daily/occurrence/Focus | Home e Day Dial compartilham o Daily Schedule canônico:** Home, Day Dial e Planner não podem reconstruir recorrência, overdue, Habits, Remin | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-26 | 26 (line-level original ordering 26) | daily/occurrence/Focus | Planner é projeção do Daily Schedule canônico:** Day Timeline, Adaptive, Week e Month recebem snapshots de `DailyScheduleEngine` já resolvid | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-27 | 27 (line-level original ordering 27) | daily/occurrence/Focus | Universal Detail só edita por mutação localizada segura:** o botão `Edit` só pode aparecer quando a coverage matrix vendorizada declarar `pa | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-28 | 28 (line-level original ordering 28) | daily/occurrence/Focus | Search/Browse/pickers usam uma única projeção do VaultIndex:** busca textual, Browse e seletores de objetos devem consumir `src/core/object- | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-29 | 29 (line-level original ordering 29) | daily/occurrence/Focus | Reminder desktop abre o alvo canônico:** o gateway de notificação recebe o `ReminderDeliveryOccurrence` entregue e o click deve abrir o `sou | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-30 | 30 (line-level original ordering 30) | daily/occurrence/Focus | Calendar externo continua read-only ao abrir eventos:** ocorrências de Google Calendar projetadas no Daily Schedule podem abrir somente o `h | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-31 | 31 (line-level original ordering 31) | daily/occurrence/Focus | Reschedule é mutação de planning, não occurrence response:** a UI usa `OccurrenceActionPolicy.canReplan`, mas a escrita passa pelo owner can | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-32 | 32 (line-level original ordering 32) | daily/occurrence/Focus | System/Routine Run usa execution evidence, não um checkbox de occurrence:** ocorrências de `system` e `routine` podem oferecer `Run`/`Run ro | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-33 | 33 (line-level original ordering 33) | daily/occurrence/Focus | Focus/Pomodoro runtime é um único owner compartilhado e timestamp-based:** `src/core/focus-runtime/*` contém somente as regras puras contrat | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-34 | 34 (line-level original ordering 34) | Journal/capture | Daily note do Quartzo tem projeção canônica única no Companion:** o parser aceita tanto `type: daily` (formato escrito pelo Quartzo) quanto  | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-35 | 34 (line-level original ordering 35) | Journal/capture | Smart Link Capture é advisory, não source of truth:** o Companion pode sugerir Social Post, Recipe ou Resource ao analisar uma URL, mas a se | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-36 | 35 (line-level original ordering 36) | Journal/capture | Resource media types são sugestões extensíveis:** Tool, Sewing Pattern e tipos futuros/customizados continuam sendo Resources com `media_typ | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-37 | 36 (line-level original ordering 37) | Journal/capture | Import genérico de páginas passa pelo boundary seguro:** Link Capture, Recipe import e metadata genérica não podem fazer fetch direto na UI. | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-38 | 34 (line-level original ordering 38) | identification/organization | Object Identification e Type Conflicts são projeção canônica do índice:** `app/quartzo_shared_settings.md` é o único owner cross-client de T | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-39 | 35 (line-level original ordering 39) | identification/organization | Alterações futuras de vault object começam no upstream:** qualquer novo `ObjectType`, rename/alias persistido, campo persistido, enum persis | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-40 | 36 (line-level original ordering 40) | identification/organization | Selection scope is not an identification rule.** Folder/file selection is a scope, not an Object Identification rule. Using a folder as a sc | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-41 | 37 (line-level original ordering 41) | identification/organization | Reclassify mutates objects to satisfy an existing TypeSignature; it never edits TypeSignature.** The Reclassify operation changes the object | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-42 | 38 (line-level original ordering 42) | identification/organization | Structural TypeSignature migration uses revision + transition and cannot finalize while dependent content transport is unresolved.** When a  | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-43 | 39 (line-level original ordering 43) | identification/organization | Shared Object Identification may reconcile independently of full vault content sync, but uses the same canonical shared-settings file and ex | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-44 | 40 (line-level original ordering 44) | identification/organization | Object Organization operations never create a second canonical object store.** No database, no `ObjectOrganizationSync`, no `MergeSync`, no  | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-45 | 41 (line-level original ordering 45) | identification/organization | Merge is ID-based and cross-type merge requires explicit target type + survivor + reconciliation.** Merge never happens by title/filename ma | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-46 | 42 (line-level original ordering 46) | identification/organization | Manual File Explorer moves are respected; mismatch becomes an Issue instead of automatic move-back.** When the user manually moves a file in | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-47 | 43 (line-level original ordering 47) | identification/organization | Release metadata e preflight são atômicos:** todo bump de release deve usar o caminho canônico `npm run release:prepare -- <version>` para a | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-48 | 44 (line-level original ordering 48) | organization/release | Organization Issues exclusions são escopo da projeção, não Object Identification:** `app/**` é sempre excluído dos subjects/candidates ordin | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-49 | 45 (line-level original ordering 49) | organization/release | Resolver Organization Issue exige mutação real + pós-condição canônica:** preview/apply de Reclassify/Organize parte dos bytes Markdown atua | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |
| C-GUID-50 | 46 (line-level original ordering 50) | organization/release | Bulk delete de Organization Issues usa retirement canônico e nunca raw delete:** excluir um ou vários subjects de Issues deve converter cada | `guidelines.md` | Exact text relocated | Owner and contract parity require explicit verification |

## Local architectural owner traceability

These original architecture bullets have been preserved and grouped into named owner sections. Their text remains current pending independent source verification.

| Stable ID | Source line in original agents.md | Source owner/evidence (excerpt) | Destination | Action |
|---|---|---|---|---|
| C-ARCH-01 | agents.md:5 | - **core**: Parsing de objetos, Scheduler, Daily Schedule, Occurrences. Esta camada não depende do Obsidian nem do DOM, ideal | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-02 | agents.md:6 | - **vault**: Integração com Obsidian. Observa arquivos locais, manipula parse/write e indexação derivadas. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-03 | agents.md:7 | - **sync**: Implementa reconciliação do Drive (push, pull, conflict, baselines) usando estado local isolado. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-04 | agents.md:8 | - **integrations**: Google Auth Loopback para Desktop (sem webview), chamadas à API Drive V3. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-05 | agents.md:9 | - **platform**: Helpers de Obsidian, Lifecycle, Secrets, Notificações do sistema. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-06 | agents.md:10 | - **ui**: Shell do plugin, Home, Planner, Journal, Search, Configurações. Usar Vanilla DOM via Obsidian API, sem react/vue/sv | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-07 | agents.md:11 | - **local-state**: Abstração do estado de sincronização e token cache, armazenado localmente (`data.json` para pequeno, file- | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-08 | agents.md:13 | - **Companion local-first sync model:** quando o vault selecionado já está dentro do Google Drive Desktop ou outra pasta sinc | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-09 | agents.md:15 | - **OAuth loopback:** O listener desktop deve validar `state` somente em respostas que sejam callbacks OAuth reais. Requests  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-10 | agents.md:17 | - **OAuth Desktop credentials:** Drive e Calendar devem usar o mesmo `GoogleOAuthDesktop` canônico. O token exchange e o refr | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-11 | agents.md:19 | - **Obsidian SecretStorage IDs:** todos os IDs usados em `app.secretStorage` devem vir do owner canônico `src/platform/secret | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-12 | agents.md:21 | - **Large-vault pairing:** initial pairing must stay linear in the number of vault files. A recursive Drive inventory carries | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-13 | agents.md:23 | - **Safe ambiguous-pairing cleanup:** user-triggered cleanup of duplicate Drive identities must be computed by the canonical  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-14 | agents.md:25 | - **Drive quota resilience:** per-minute Google Drive quota/rate-limit responses (including retryable 403 quota exhaustion) a | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-15 | agents.md:27 | - **First-pairing apply progress:** `DriveSyncCoordinator.applyPairingDecisions()` is the canonical owner of mutation progres | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-16 | agents.md:29 | - **Persistent first-pairing failure projection:** the canonical coordinator owns the last apply failure as transient read-on | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-17 | agents.md:31 | - **Single-surface first-pairing UI:** the plugin owns one `pairingWorkflowModal` surface for the complete first-pairing flow | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-18 | agents.md:33 | - **Safe-trash postcondition:** `GoogleDriveAdapter.trashFile()` must request and verify the returned `trashed` field; an ack | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-19 | agents.md:35 | - **Drive trash capability is part of safe-cleanup evidence:** ambiguous-pairing inventory must project `capabilities.canTras | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-20 | agents.md:37 | - **Canonical vault file scope:** `src/sync/coordinator/file-policy.ts` is the single owner of sync eligibility for local and | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-21 | agents.md:39 | - **First-pairing live revalidation:** `DriveSyncCoordinator.applyPairingDecisions()` revalidates the current unknown-base ve | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-22 | agents.md:41 | - **Incremental Drive trash semantics:** `GoogleDriveAdapter.listChanges()` must request/project `file.trashed`. `DriveSyncCo | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-23 | agents.md:43 | - **Stale persisted remote owner revalidation:** before throwing `Ambiguous incremental remote identity`, `DriveSyncCoordinat | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-24 | agents.md:45 | - **Long-running operation progress:** progress must come from the canonical owner that is already executing the work (for ex | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-25 | agents.md:47 | - **Post-pairing remote duplicate recovery:** a true duplicate identity discovered by incremental sync or full reconciliation | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-26 | agents.md:49 | - **Drive request deadlines:** `GoogleDriveAdapter` is the sole owner of Google Drive network request deadlines. Metadata/lis | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-27 | agents.md:51 | - **Startup sync-state hydration:** `DriveSyncCoordinator` remains the sole owner of the file-backed device-local sync state. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-28 | agents.md:53 | - **Occurrence actions e shared occurrence state:** `src/core/occurrence_actions/OccurrenceActionService` é o único coordenad | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-29 | agents.md:55 | - **Canonical System/Routine manual execution:** `src/core/manual-execution/*` owns the pure cross-client capability, referen | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-30 | agents.md:57 | - **Canonical Focus/Pomodoro runtime:** `src/core/focus-runtime/*` owns the pure executable contract for controller capabilit | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-31 | agents.md:59 | - **Canonical occurrence Reschedule:** `src/core/occurrence_reschedule/*` owns the pure cross-client planning mutation plan a | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-32 | agents.md:61 | - **Canonical Home/Day Dial projection:** `DailyScheduleEngine` continua sendo o único owner no Companion para decidir o que  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-33 | agents.md:63 | - **Canonical Planner projection:** `src/ui/planner/*` is presentation-only over `NormalizedSchedule` snapshots produced by ` | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-34 | agents.md:65 | - **Canonical Universal Detail mutation:** `src/core/object-mutation/*` derives edit capability directly from vendored `contr | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-35 | agents.md:67 | - **Canonical object query owner:** `src/core/object-query/index.ts` is the single read-only query projection over the existi | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-36 | agents.md:69 | - **Reminder delivery platform boundary:** `ObsidianReminderDeliveryGateway` must stay importable in isolated tests and there | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-37 | agents.md:71 | - **Reminder notification navigation:** `ObsidianReminderDeliveryGateway` projects delivery only; on desktop click it passes  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-38 | agents.md:73 | - **Google Calendar external navigation:** Google Calendar remains a read-only external projection. The shell resolves a `Nor | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-39 | agents.md:75 | - **Obsidian vault readiness before canonical indexing:** the Companion must not build its initial `VaultIndexEngine`, start  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-40 | agents.md:77 | - **Cross-client shared settings reindex:** `app/quartzo_shared_settings.md` is the Companion's canonical interpretation inpu | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-41 | agents.md:79 | - **Canonical Object Identification migration:** structural edits to `markerType` or `markerValue` must go through `src/core/ | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-42 | agents.md:81 | - **Production audit infrastructure resilience:** CI, Release Preflight and Release must share the same fail-closed productio | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-43 | agents.md:83 | - **Canonical Smart Link Capture:** `src/core/link-capture` owns pure URL destination suggestion, override precedence, common | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-44 | agents.md:85 | - **Resource media types remain Resource-owned:** `Tool`, `Sewing Pattern` and future user-defined values are `Resource.media | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-45 | agents.md:91 | - **Shared settings persistence** → `SharedSettingsRepository` / `SettingsNotifier`. No second settings store. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-46 | agents.md:92 | - **Object Identification** → `TypeSignature` / shared identification resolver (`src/core/shared-settings`). Parsing uses tra | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-47 | agents.md:93 | - **Structural migration** → `ObjectIdentificationMigrationRepository` + planner (`src/core/object-identification-migration.t | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-48 | agents.md:94 | - **Safe field mutation** → `SafeObjectMutationRepository` (`src/vault/object-mutation.ts`). Mandatory for any single-object  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-49 | agents.md:95 | - **Merge planning** → Pure planner `src/core/object-organization/merge.ts` applied via `ObjectOrganizationRepository`. Must  | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-50 | agents.md:96 | - **Vault lifecycle** → `VaultNotifier` / Companion vault adapter. Merge losers exit through this lifecycle. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-51 | agents.md:97 | - **Sync** → existing `DriveSyncCoordinator`. Targeted `syncSharedSettingsNow()` must extend this coordinator only. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-52 | agents.md:98 | - **Queries** → `queryVaultObjects` / `VaultIndex` / `object-query`. No second index. Object picker uses this owner. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-53 | agents.md:99 | - **Scope resolution** → `src/core/object-organization/scope-resolver.ts`. Not persisted; not an identification rule. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-54 | agents.md:100 | - **Issues projection** → `src/core/object-organization/issues-projection.ts`. Non-persisted, reconstructible. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-55 | agents.md:101 | - **Operation IDs** → `src/core/object-organization/operation-id.ts`. Deterministic, not timestamp-based. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-56 | agents.md:102 | - **Preconditions** → `src/core/object-organization/preconditions.ts`. Validates revision, hash, destination before Apply. | agents.md (themed owner sections) | No new owner introduced |
| C-ARCH-57 | agents.md:103 | - **UI** → consumers only. `src/ui/organization/` and `src/ui/shell/view.ts` call canonical owners; they do not mutate direct | agents.md (themed owner sections) | No new owner introduced |


## Bootstrap, onboarding and release-document traceability

The original Companion `AGENT_BOOTSTRAP.md`, repository onboarding README and release runbook obligations are also registered here. A baseline line is source evidence, not authority to change existing release/protocol semantics.

| Baseline source | Line | Original instruction / statement excerpt | Destination | Evidence status |
|---|---:|---|---|---|
| `AGENT_BOOTSTRAP.md` | 6 | 1. Ler este arquivo (`AGENT_BOOTSTRAP.md`) primeiro. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `AGENT_BOOTSTRAP.md` | 7 | 2. Ler a especificação e contratos aplicáveis vendorados em `contracts/`. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `AGENT_BOOTSTRAP.md` | 8 | 3. Ler o arquivo `guidelines.md` local. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `AGENT_BOOTSTRAP.md` | 9 | 4. Ler o arquivo `agents.md` para arquitetura do projeto. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `AGENT_BOOTSTRAP.md` | 10 | 5. NÃO criar "owners" paralelos. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `AGENT_BOOTSTRAP.md` | 11 | 6. Rodar os testes e gates definidos antes de concluir qualquer implementação. | AGENT_BOOTSTRAP.md / AGENTS.override.md pointer | Preserved/documentation review; external behavior not proven |
| `README.md` | 5 | ## Visão geral | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 7 | - **Desktop only**: Windows, macOS e Linux. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 8 | - **Mesmo vault canônico**: objetos continuam em Markdown + YAML, sem banco de dados canônico paralelo. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 9 | - **Google Drive Sync**: pareia explicitamente com um vault Quartzo remoto existente e usa reconciliação three-way. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 10 | - **Sync manual por padrão**: `Manual` não faz sync em startup, foco, polling ou mudanças locais; `Sync now` e full reconciliation continuam disponíveis. `Automatic` | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 11 | - **Offline-first**: o trabalho local não depende de conexão contínua; a reconciliação ocorre quando o Drive está disponível. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 12 | - **Uma shell Quartzo**: Home, Planner, Journal, Browse e Activity, com Search, Add, Sync e Settings como ações. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 14 | ## Object Identification | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 20 | ## Limitações do V1 | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 22 | - Reminders são best effort e só podem ser entregues enquanto o Obsidian estiver aberto. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 23 | - `custom_script`, execução automática de Systems e daemons externos não são suportados. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 24 | - `daily_note` permanece bruto/read-only no Companion até existir contrato de parser/serializer próprio. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 25 | - Google Calendar, quando habilitado, é uma projeção read-only; o Companion não cria, edita nem apaga eventos no V1. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 26 | - Tipos sem mutation contract completo devem abrir em modo seguro/Markdown em vez de ganhar um editor simplificado que possa perder dados. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 28 | ## Instalação via BRAT | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 32 | 1. Instale e habilite o plugin BRAT no Obsidian. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 33 | 2. No BRAT, escolha **Add Beta plugin**. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 34 | 3. Informe `olalaurao/quartzo-obsidian-companion`. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 35 | 4. Instale a release estável mais recente. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 36 | 5. Habilite **Quartzo Companion** em Community plugins. | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 40 | ## Desenvolvimento e testes | README.md | Preserved/documentation review; external behavior not proven |
| `README.md` | 61 | ## Releases | README.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 7 | ## Release invariants | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 9 | - Desktop only. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 10 | - OAuth uses a Google **Desktop app** client with loopback `127.0.0.1` and PKCE. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 11 | - The release build embeds the Google Desktop OAuth **Client ID** and matching **Client Secret/client credential** for the same Desktop app client. Google requires b | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 12 | - User refresh tokens remain in Obsidian `SecretStorage`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 13 | - Release tags must point to commits contained in `main`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 14 | - `package.json`, `manifest.json`, `versions.json`, and the Git tag must describe the same release version. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 15 | - A release tag is publishable only after **Release Preflight** succeeds for that exact `main` commit SHA. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 16 | - The release workflow publishes only artifacts rebuilt and validated by GitHub Actions. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 17 | - A tag push created with a workflow's `GITHUB_TOKEN` does not recursively start the tag-triggered Release workflow. If automation creates the tag with `GITHUB_TOKEN | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 18 | - Do not move/rewrite a tag that already produced a published GitHub Release. A failed/unpublished version should be superseded by the next clean version instead of  | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 20 | ## Google Cloud setup | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 22 | 1. Create or select the Google Cloud project used for Quartzo Companion. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 23 | 2. Enable: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 24 | - Google Drive API | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 25 | - Google Calendar API | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 26 | 3. In **Google Auth Platform**, configure the app branding and audience. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 27 | 4. For beta testing, add the intended Google accounts as test users while the app remains in Testing. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 28 | 5. In **Data Access**, configure exactly the scopes requested by the Companion: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 29 | - `https://www.googleapis.com/auth/drive` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 30 | - `https://www.googleapis.com/auth/calendar.readonly` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 31 | 6. In **Clients**, create a client with application type **Desktop app**. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 32 | 7. Copy the generated **Client ID** ending in `.apps.googleusercontent.com` and its generated **Client Secret**. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 33 | - Do not commit either value to the repository source tree. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 34 | - Store both only as GitHub Actions repository secrets for release builds. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 35 | - The desktop loopback flow uses Client ID + Client Secret + PKCE; per-user refresh tokens remain the runtime security boundary and stay in Obsidian `SecretStorage`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 36 | - Do not create a Web application client for the desktop loopback flow. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 38 | ## GitHub repository setup | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 42 | - `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID` — the Desktop OAuth Client ID from Google Cloud. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 43 | - `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET` — the Client Secret/client credential from the same Desktop OAuth Client. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 49 | ## Prepare release metadata | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 59 | - `package.json` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 60 | - `manifest.json` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 61 | - `versions.json` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 62 | - `package-lock.json` when present | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 68 | - `package.json.version === manifest.json.version` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 69 | - `versions.json[package.json.version] === manifest.json.minAppVersion` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 73 | ## Production preflight | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 77 | 1. Record the exact `main` commit SHA that contains the release metadata. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 78 | 2. Wait for the normal CI on that commit to finish successfully. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 79 | 3. Open GitHub Actions. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 80 | 4. Run **Release Preflight** manually on `main`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 81 | 5. Confirm the successful preflight run reports the same exact `head_sha` as the intended release commit. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 82 | 6. The workflow must pass: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 83 | - OAuth Client ID presence/shape | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 84 | - OAuth Client Secret presence and artifact injection for the matching Desktop client | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 85 | - canonical contract verification | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 86 | - typecheck/lint/tests | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 87 | - sync tests | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 88 | - architecture gates | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 89 | - production build | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 90 | - release validation | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 91 | - clean artifact smoke | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 92 | 7. Download the generated `quartzo-companion-<sha>` Actions artifact if a manual install test is desired. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 96 | ## Publish release | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 100 | 1. Confirm the intended version is still the one in `package.json`, `manifest.json`, and `versions.json`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 101 | 2. Confirm `main` has not moved since the successful Release Preflight. If it moved, run Release Preflight again on the new intended release commit. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 102 | 3. Create the tag with the exact version string, without a leading `v`, pointing to the preflighted commit. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 103 | 4. Publish through the single canonical **Release** workflow: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 104 | - a normal human/PAT tag push may trigger it directly; or | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 105 | - if a GitHub Action created/pushed the tag with its `GITHUB_TOKEN`, explicitly dispatch **Release** with `release_tag=<exact version>` because GitHub suppresses rec | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 106 | 5. In either trigger mode, the **Release** workflow verifies that: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 107 | - the named tag exists and resolves to the checked-out commit; | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 108 | - the tag commit is contained in `main`; | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 109 | - a successful Release Preflight exists for that exact commit SHA; | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 110 | - release metadata and tag version agree. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 111 | 6. The workflow then rebuilds from the tagged commit and publishes a GitHub release containing: | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 112 | - `main.js` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 113 | - `manifest.json` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 114 | - `styles.css` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 115 | - `SHA256SUMS.txt` | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 119 | ## Install with BRAT | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 121 | 1. Install and enable BRAT in Obsidian Desktop. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 122 | 2. Choose **Add Beta plugin**. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 123 | 3. Enter `olalaurao/quartzo-obsidian-companion`. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 124 | 4. Let BRAT install the latest validated release. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 125 | 5. Enable **Quartzo Companion** in Community plugins. | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |
| `docs/BETA_RELEASE_RUNBOOK.md` | 127 | ## OAuth beta caveat | docs/BETA_RELEASE_RUNBOOK.md | Preserved/documentation review; external behavior not proven |

## Static discovery evaluation results — 2026-10-08

The three Companion developer scenarios were traced directly against the PR source tree: Drive pairing → existing `DriveSyncCoordinator` and vendored `UPSTREAM.lock.json`; Organization → existing `ObjectOrganizationRepository` and merge planner; Release → canonical runbook, exact-SHA preflight and release workflows. All three passed **static source/marker checks**. The five Quartzo-side probes also passed their static checks. A Vitest gate now guards these three Companion paths.

This is **not** evidence of eight new, independent agent sessions or of before/after agent efficiency. Those real executions remain explicitly open; no claim of an observed model result is made by this ledger.

## Eight clean-agent before/after scenarios

Testing must happen in fresh sessions, without giving either run the prior chat. Record actual files loaded, decisions, references to owners/contracts, safety and gate commands.

| Scenario | Expected outcome | Before | After |
|---|---|---|---|
| Flutter spacing change | design-system token + reusable component | Not executed | Not executed |
| Add persisted object field | model/parser/serializer/fixtures + Companion sync | Not executed | Not executed |
| Finance business rule | Finance Google Sheets only; no vault | Not executed | Not executed |
| Companion pairing failure | coordinator, adapter, file policy, operational spec | Not executed | Not executed |
| Scheduled occurrence action | exact occurrence identity, shared action owner | Not executed | Not executed |
| Object Identification across clients | upstream shared settings/migration + vendored contract | Not executed | Not executed |
| Organization UI | owner repository/index/selection; no new state store | Not executed | Not executed |
| Companion Release | validated preflight/version/provenance pipeline | Not executed | Not executed |

## Remaining certification

The content-preserving reorganization and automated source/layout checks are distinct from real new-agent behavioral evidence. Execute both before and after in genuinely new agent sessions, compare efficiency and verify contracts against code; do not claim 100% until all steps and full CI are green.
