# SPEC — Quartzo Object Organization & Obsidian-native Organization V1

Status: **IMPLEMENTATION SPEC — status of runtime delivery requires independent verification**  
Last reconciled date: 2026-10-08 (document authority header only)  
Last reconciled main SHA: `507f2ccfe2f991ea775e1f1aca5ca05e6f4c5218`  
Canonical implementation owners: `ObjectOrganizationRepository`, `ObjectIdentificationMigrationRepository`, `SharedSettingsRepository`, `VaultIndexEngine`, `DriveSyncCoordinator`  
Depends on: vendored Quartzo object-organization contracts, `contracts/UPSTREAM.lock.json`, `guidelines.md`, `agents.md`  
Supersedes: prior Object Organization execution plans when independently validated  
Authority boundary: Companion-specific Object Organization interaction and mutation; upstream remains the source of shared semantics

**Original status:** implementation specification  
**Repositories affected:** `olalaurao/aplicativo` + `olalaurao/quartzo-obsidian-companion`  
**Primary domains:** Object Identification, object mutation, merge, references, shared settings, vault sync, Obsidian UX  
**Goal:** permitir organizar, corrigir, mover, relacionar, reclassificar e mesclar objetos diretamente pelo Obsidian Companion, mantendo Quartzo e Companion semanticamente idênticos e sem criar nova fonte de verdade ou novo mecanismo paralelo de sync.

---

# 0. Bootstrap obrigatório antes de implementar

Antes de alterar código:

1. No Quartzo, ler `AGENT_BOOTSTRAP.md`, a spec ativa criada por este trabalho, as seções aplicáveis de `guidelines.md` e `agents.md`.
2. No Companion, ler `AGENT_BOOTSTRAP.md`, contratos vendorados aplicáveis, `guidelines.md` e `agents.md`.
3. Mapear os owners atuais antes de criar qualquer classe.
4. Não criar owner/service/provider/model/source of truth paralelo quando já existir caminho canônico.
5. Se esta spec estabelecer uma regra permanente nova, atualizar `guidelines.md`/`agents.md` no mesmo trabalho.
6. Rodar testes/gates/CI aplicáveis antes de concluir.

O bootstrap atual do Quartzo já determina que operações complexas de metadata como rename/merge devem preferir UX multi-select. 

---

# 1. Resultado final esperado

O Companion deve aproveitar o fato de estar **dentro do Obsidian**.

O usuário não deve precisar abrir uma tela específica de Object Identification toda vez que quiser organizar alguma coisa.

As mesmas operações canônicas devem estar acessíveis a partir de:

- File Explorer;
- multi-selection no File Explorer;
- folder context menu;
- editor context menu;
- URL/link context quando aplicável;
- Command Palette/hotkeys;
- Folder Overview;
- Object Organizer;
- Issues / Organization Inbox;
- Review Mode;
- Object Identification Rules.

Todas essas superfícies chamam os **mesmos owners canônicos**.

Arquitetura final:

```text
Obsidian File Explorer ─┐
Multi-selection ────────┤
Folder context ─────────┤
Editor ─────────────────┤
Command Palette ────────┤
Folder Overview ────────┤
Object Organizer ───────┤
Issues / Review Mode ───┘
             │
             ▼
Canonical Object Organization Operations
             │
 ┌───────────┼────────────┐
 ▼           ▼            ▼
Reclassify   Merge      Safe Mutation
Move         Relate     Rule Migration
             │
             ▼
          Vault
             │
             ▼
 existing vault transport/sync
```

Separadamente:

```text
Quartzo
   │
   ├──── app/quartzo_shared_settings.md ────┐
   │                                        │
   └──────────────────────────────────── Companion
```

Object Identification continua cross-client.

Não criar:

- Organizer database;
- ObjectOrganizationSync;
- MergeSync;
- ReclassifySync;
- outro índice canônico;
- outro settings store;
- outro relationship store.

---

# 2. Baseline canônico atual que deve ser preservado

## 2.1 Shared Object Identification

A fonte cross-client existente é:

```text
app/quartzo_shared_settings.md
```

Quartzo e Companion devem ler e escrever esse mesmo documento.

O Quartzo já tem `SharedSettingsRepository`; o Companion também já tem `SharedSettingsRepository`.  

O Companion já resolve objetos usando `TypeSignature` compartilhada e suporta:

- `folder`;
- `property`;
- `tag`;
- prioridade de identificação;
- identificação conflitante.

Não recriar essa lógica. 

## 2.2 Structural Object Identification migration

A arquitetura atual já determina que uma alteração de `markerType` ou `markerValue` é estrutural e precisa de preflight/migration. A migração pertence ao owner de migration, não à UI. 

O contrato atual também exige as escolhas:

- Cancel;
- Save only;
- Migrate.

`Save only` altera apenas shared settings/reindex.

`Migrate` pode alterar markers e fazer safe folder-marker path move, preservando ID, conteúdo e campos desconhecidos. 

Essa semântica deve continuar válida.

## 2.3 Companion migration

O Companion já possui:

- `src/core/object-identification-migration.ts`;
- `src/vault/object-identification-migration.ts`;
- preflight;
- blockers de destination;
- protection contra preview stale;
- apply idempotente parcial.

Estender. Não substituir.  

## 2.4 Safe mutations

O Companion já possui `SafeObjectMutationRepository`, que usa `Vault.process()`.

Qualquer bulk edit simples deve compor esse owner ou sua evolução canônica. 

## 2.5 Merge

O Quartzo já possui `MergeService`.

Ele já possui:

- survivor;
- losing objects;
- reconciliation;
- reference repointing;
- snapshot/preflight;
- rollback local;
- canonical delete lifecycle;
- event log de merge.

Não criar um novo merge engine no Companion antes de extrair/contratar essa semântica upstream. 

O Quartzo também já possui `MergeFlowOrchestrator` com target type + reconciliation + merge confirmation, porém hoje o survivor é escolhido automaticamente pelo `updatedAt`; esta spec altera essa UX para permitir escolha explícita e paridade com o Companion. 

---

# 3. Definições fundamentais

## 3.1 Vault Content Sync

É o transporte/reconciliação de arquivos do vault:

- Markdown;
- `.base`;
- attachments permitidos;
- deletes/renames;
- demais caminhos canônicos.

Continua usando o sync/reconciliation existente.

## 3.2 Shared Settings Sync

É a convergência de:

```text
app/quartzo_shared_settings.md
```

Não representa uma segunda fonte de verdade.

O arquivo continua sendo a única fonte persistida.

A novidade desta spec é permitir que sua reconciliação seja **prioritária/targeted e independente do modo de full vault content sync**, reutilizando o coordenador/protocolo existente.

## 3.3 Selection Scope

É apenas **o conjunto de objetos sobre o qual uma operação será executada**.

Pode vir de:

- um arquivo;
- arquivos selecionados;
- uma pasta;
- várias pastas;
- pasta + subpastas;
- query do Organizer;
- Issues;
- Folder Overview.

Uma pasta usada como selection scope **não vira uma Object Identification rule**.

Regra permanente nova:

> **Folder/file selection is a scope, not an Object Identification rule.**

## 3.4 Reclassify

Muda determinados objetos para satisfazer uma TypeSignature existente.

Não muda a TypeSignature.

## 3.5 Rule mutation

Muda a própria TypeSignature.

Pode afetar todo o vault.

## 3.6 Merge

Consolida múltiplos object IDs em um survivor, atualiza referências e retira os objetos absorvidos através do lifecycle canônico.

## 3.7 Organize

Operação composta que pode reunir:

- Reclassify;
- Move;
- property mutation;
- relationship mutation.

É uma única operação planejada/validada, não uma sequência improvisada pela UI.

---

# 4. Regra UX mais importante

Estas duas ações precisam ser inequivocamente diferentes:

```text
Set objects in this folder as Resource
```

versus:

```text
Identify Resources by this folder
```

A primeira:

- usa a pasta como scope;
- altera os arquivos selecionados;
- mantém a regra de Resource.

A segunda:

- altera a TypeSignature;
- potencialmente afeta centenas de arquivos;
- exige impact analysis/migration.

Nunca usar copy que permita confundir as duas.

---

# 5. Object Organization Contract V1

Criar no Quartzo, em `contracts/quartzo/`, um contrato language-neutral de Object Organization.

Nome sugerido:

```text
contracts/quartzo/object_organization/
```

com:

```text
contract.json
vectors.json
README.md
```

Atualizar `contract_manifest.json` com:

```text
objectOrganizationContractVersion
```

O Companion deve vendorar esse contrato usando o pipeline já existente.

---

# 6. Operações contratadas

O V1 deve definir pelo menos:

```text
reclassify
bulk_mutate
move
organize
relate
merge
reference_rewrite
fix_identification
rule_change
rule_migration
```

Não é necessário que todas compartilhem exatamente a mesma struct interna, mas precisam compartilhar identidade e preconditions.

Modelo conceitual:

```text
operationId
kind
createdAt

baseSettingsRevision

scope
affectedObjectIds
affectedPaths

preconditions

plannedActions
warnings
blockers

recoverySemantics
```

---

# 7. Operation ID e idempotência

Toda operação estrutural ou bulk deve possuir `operationId` estável.

Reexecutar a mesma operação após:

- UI rerender;
- retry;
- restart;
- partial I/O failure

não pode duplicar efeitos.

Cada action deve conseguir distinguir:

- ainda não aplicada;
- já aplicada exatamente;
- estado mudou e precisa abortar/replanejar.

Não usar timestamp como chave de idempotência.

---

# 8. Preconditions obrigatórias

Antes de Apply:

- settings revision ainda precisa ser válida;
- object ID precisa continuar correspondendo ao objeto;
- source path precisa continuar válido;
- hash/current Markdown precisa coincidir com preview quando necessário;
- destination não pode ter aparecido;
- reference graph relevante precisa continuar válido;
- survivor/losers de merge precisam continuar existentes;
- nenhuma nova incompatibilidade pode ter surgido.

Preview não é autorização para sobrescrever um estado mais novo.

---

# 9. Revision de Object Identification

Evoluir o schema de shared settings.

Hoje há `schema_version` e `updated_at`, mas não existe uma revision monotônica específica de Object Identification. 

Adicionar uma revision canônica.

Estrutura conceitual:

```yaml
object_identification:
  revision: 42
```

A revision:

- aumenta apenas quando semântica compartilhada de Object Identification muda;
- não depende do relógio;
- não usa `updated_at` como conflito resolver;
- participa dos preconditions de operações estruturais.

Appearance-only pode compartilhar a mesma revision ou uma revision separada se os contracts indicarem que é melhor; não criar complexidade sem necessidade.

---

# 10. Transition protocol para rule migration

Adicionar estado transitório compartilhado.

Conceitualmente:

```yaml
object_identification:
  revision: 42

  transition:
    operation_id: "..."
    object_type: resource
    base_revision: 42
    target_revision: 43
    old_signature: ...
    new_signature: ...
    phase: applying
```

Fases mínimas:

```text
planning
applying
awaiting_transport
committing
failed
```

Não persistir `planning` remotamente se nenhuma mutação começou; a necessidade principal começa antes do primeiro content write.

---

# 11. Semântica durante transition

Durante uma transição estrutural:

- old signature e new signature são reconhecidas como representações equivalentes **do mesmo object type**;
- não gerar falso conflito entre elas;
- outro cliente não pode iniciar migration incompatível;
- edição de TypeSignature estrutural conflitante fica disabled;
- arquivos parcialmente migrados continuam identificáveis;
- parser/reindex precisam conhecer o transition state.

Ao finalizar:

```text
revision: 43
signature: newSignature
transition: null
```

---

# 12. Save only continua obrigatório

Structural Rule Editor continua oferecendo:

```text
Cancel
Save only
Migrate
```

### Save only

- grava nova signature;
- incrementa revision;
- não altera objetos;
- reindexa;
- Issues pode então revelar objetos que não combinam mais com a nova regra.

### Migrate

- inicia transition;
- aplica object migration;
- sincroniza/transporta conforme cenário;
- só então finaliza revision.

Não remover esta opção porque já faz parte do contrato vigente. 

---

# 13. Shared Settings Transport independente de full vault sync

Requisito de produto:

> Object Identification deve continuar convergindo entre Quartzo e Companion independentemente de o usuário ter habilitado o full vault sync do Companion.

Isso **não** significa criar outro banco ou outro protocolo.

Implementar uma operação targeted no coordenador de sync existente:

```text
syncSharedSettingsNow()
```

ou equivalente arquiteturalmente apropriado.

Ela reconcilia somente:

```text
app/quartzo_shared_settings.md
```

usando:

- mesmo Drive adapter;
- mesmo remote identity;
- mesmos hashes;
- mesmo three-way reconciliation;
- mesmo auth owner;
- mesmo operation lock/coordinator.

Não duplicar código de Drive ou reconciliation.

---

# 14. Evitar dupla reconciliação do shared settings

Se full vault sync e shared-settings targeted sync puderem alcançar o mesmo path:

- ambos devem passar pelo mesmo coordinator;
- operações precisam serializar/coalescer;
- nunca dois writers concorrentes;
- uma solicitação targeted durante full sync não cria second sync engine;
- o coordinator pode considerar aquele path já processado e evitar trabalho duplicado.

---

# 15. Sync-mode semantics

Separar conceitualmente na UI:

```text
Vault content sync
Shared settings
```

Exemplo:

```text
Vault sync
Manual

Shared Quartzo settings
Synced
```

Não chamar tudo simplesmente de “Sync”, porque o usuário precisa entender por que Object Identification ainda converge quando content sync está Manual/Off.

---

# 16. Matriz de sync obrigatória

## Cenário A — Companion paired + Automatic

Shared settings:

- targeted updates podem acontecer imediatamente;
- full sync também pode transportá-las;
- coordinator evita duplicação.

Object mutation:

- grava local;
- entra no full vault reconciliation normalmente.

## Cenário B — Companion paired + Manual/content sync desligado

Shared settings:

- continuam podendo usar targeted reconciliation;
- mudança de icon/color/rule Save only pode chegar ao Quartzo.

Object mutation:

- permanece local até `Sync now` ou outra forma de transporte.

Exemplo:

```text
Set 20 files as Resource
```

não é enviado magicamente por Shared Settings Sync.

## Cenário C — Companion sem Drive pairing, vault em Google Drive Desktop/outro filesystem sync

Companion:

- trabalha local-first;
- grava arquivos normais;
- grava `app/quartzo_shared_settings.md`;
- filesystem provider transporta bytes.

Não iniciar Drive API em paralelo.

Watchers do Companion precisam detectar shared settings vindo do filesystem e:

1. reload shared settings;
2. reindex;
3. atualizar UI.

## Cenário D — Companion local-only, sem pairing e sem filesystem transport

Tudo funciona localmente.

Mas UI de shared settings deve deixar claro:

```text
Shared settings
Local only
```

Não afirmar “Synced”.

## Cenário E — Quartzo mobile content sync habilitado

Shared settings deve ser carregado/reconciliado antes do parsing dependente dele.

O SyncManager atual já detecta mudanças de `SharedSettingsRepository.path`; manter essa integração. 

## Cenário F — Quartzo content sync manual/desligado mas Drive configurado

Shared Settings targeted sync continua disponível segundo esta spec.

Object files continuam obedecendo content sync mode.

## Cenário G — completamente offline

Nenhum cliente pode prometer cross-device convergence.

Object mutations locais podem continuar quando seguras.

Rule mutation que precise provar latest remote revision deve ficar fail-closed ou permanecer local/pending conforme as regras abaixo.

---

# 17. Regra especial para structural Migrate com content sync desligado

Este é o caso mais delicado.

Se:

- shared settings consegue sincronizar;
- mas object content não consegue;

não finalizar uma nova TypeSignature remotamente enquanto centenas de objetos dependentes continuam sem transporte.

Fluxo:

```text
ACTIVE 42
    ↓
TRANSITION 42→43
    ↓
local migration
    ↓
awaiting_transport
```

Enquanto os object writes não tiverem caminho de transporte confirmado:

- transition permanece;
- old + new signature continuam equivalentes;
- revision 43 não vira ACTIVE.

Quando content transport acontecer:

```text
awaiting_transport
→ reconciliation confirmed
→ commit ACTIVE 43
```

---

# 18. Filesystem-sync exception

Quando o Companion opera em vault mantido por Google Drive Desktop/outro filesystem provider:

- não há confirmação via Companion de que cada byte chegou ao cloud;
- transition ainda protege clientes contra propagação fora de ordem.

O cliente remoto que vir `transition` deve aceitar old/new signature.

Só limpar o transition após a política definida pelo contrato.

Não assumir que “arquivo gravado localmente = propagado remotamente”.

---

# 19. Reclassify Contract

`Reclassify` recebe:

```text
objectId
targetType
expectedPath
expectedHash
settingsRevision
```

O planner:

1. resolve current object;
2. obtém evidence atual de Object Identification;
3. obtém target TypeSignature;
4. calcula markers a remover;
5. calcula target marker;
6. calcula eventual move;
7. preserva ID;
8. preserva body;
9. preserva campos desconhecidos;
10. valida destination;
11. detecta ambiguidades;
12. gera preview.

---

# 20. Reclassify ≠ alterar `type` cegamente

Não implementar:

```text
frontmatter.type = targetType
```

como lógica universal.

A operação precisa fazer o objeto satisfazer a TypeSignature canônica atual.

Exemplos:

### Property

```text
Resource → property type: resource
```

aplicar property.

### Tag

aplicar/remover tag canônica.

### Folder

mover ao folder correto.

Se markers antigos de outro tipo continuarem causando conflict, planner precisa removê-los somente quando fizer parte da semântica contratada.

---

# 21. Multiple matching signatures

Se um objeto atualmente corresponde a:

```text
Resource
Note
```

Reclassify para Project deve planejar a remoção dos competing identification markers necessários.

Nunca confiar apenas no `resolvedType` e deixar markers contraditórios ocultos.

Exibir preview:

```text
Identification changes

Remove:
Note — Folder Notes/
Resource — Tag #resource

Apply:
Project — Property type=project
```

---

# 22. Reclassify de Markdown ainda não identificado

Permitir transformar Markdown comum em objeto quando:

- arquivo está dentro do vault;
- parser consegue ler frontmatter/body com segurança;
- não há YAML inválido;
- object ID pode ser criado pelo canonical ID owner;
- target type tem criação/mutation semantics suficientes.

Preview deve distinguir:

```text
Already Resource          8
Will become Resource     61
Blocked                   5
```

Não inventar properties opcionais.

Aplicar somente:

- canonical ID necessário;
- canonical type identification;
- campos estruturalmente obrigatórios.

---

# 23. Scope Resolver canônico no Companion

Criar um owner de **selection resolution**, não de objetos.

Ele transforma inputs de Obsidian em:

```text
ResolvedOrganizationScope
```

contendo:

```text
files
folders
eligibleMarkdownPaths
indexedObjectIds
unidentifiedMarkdownPaths
ignoredAttachments
ignoredBases
duplicatesRemoved
```

Não persistir esse scope.

---

# 24. Folder scope

Sempre oferecer:

```text
This folder only
This folder + all subfolders
```

Nunca inferir recursive sem mostrar.

Contagem precisa aparecer antes de Apply.

---

# 25. Mixed scope

Suportar quando recebido pela API:

- files;
- folders;
- combinação.

Resolver union com dedupe por normalized path.

Exemplo:

```text
2 folders
3 files

Include subfolders: Yes

73 Markdown files
68 eligible
5 ignored
```

---

# 26. Não transformar attachments automaticamente

Exemplo:

```text
folder/
  note.md
  image.png
  pattern.pdf
  data.base
```

`Set objects as Resource` atua apenas em Markdown elegível.

A UI mostra o que foi ignorado.

Attachments podem futuramente participar de Resource capture, mas não nesta operação.

---

# 27. Obsidian File Explorer integration

Usar APIs públicas.

A API oficial atual expõe:

- `file-menu` para arquivo/pasta;
- `files-menu` para multi-selection;
- `editor-menu` para editor.

`files-menu` é API pública desde Obsidian 1.4.10. O Companion atualmente exige Obsidian 1.11.4, portanto pode usar essa API sem DOM hack.

Registrar tudo com `registerEvent`.

Não acessar estado privado do File Explorer.

---

# 28. Single-file context menu

Para Markdown:

```text
Quartzo
  Set type...
  Organize...
  Edit object properties...
  Add to...
  Find possible duplicates
  Review identification
  Open in Quartzo
```

Para objeto já conhecido:

- `Open in Quartzo` abre Universal Detail;
- `Review identification` abre evidence.

Para unidentified Markdown:

- `Set type...` continua disponível;
- Detail comum só após classificação segura.

---

# 29. Multi-selection context menu

Com 2+ arquivos/pastas:

```text
Quartzo
  Set type...
  Organize...
  Edit properties...
  Add to...
  Merge objects...
  Review selection...
```

`Merge objects...` só aparece quando:

- existem pelo menos 2 objetos elegíveis;
- capability planner consegue ao menos iniciar preflight.

Não permitir menu action executar destruição imediatamente.

---

# 30. Folder context menu

```text
Quartzo
  Set objects as...
  Organize folder...
  Edit object properties...
  Review folder...
  Find identification issues
  Find possible duplicates
```

Não mostrar:

```text
Make this the Resource folder
```

como ação equivalente.

Se houver ação de Rule:

```text
Create identification rule from folder...
```

ela fica claramente separada e abre Rule Editor.

---

# 31. Quick object types no menu

Para não criar submenu gigante:

Settings:

```text
File Explorer integration

Quick types
1. Resource
2. Note
3. Project
```

Menu:

```text
Set as Resource
Set as Note
Set as Project
Set type...
```

`Set type...` abre searchable picker.

Quick types são preference device-local.

Não afetam shared settings.

---

# 32. Organize operation

Implementar operação composta.

Payload conceitual:

```text
scope
targetType?
destinationFolder?
propertyOperations[]
relationshipOperations[]
```

Planner produz **um plano único**.

Exemplo de UX:

```text
Organize 12 objects

Type
Resource

Move to
Resources/Sewing/

Category
Add Sewing

Organizer
Set Costura

Related to
Vestido Azul

Preview
12 type changes
12 moves
12 category changes
12 relationships
```

---

# 33. Atomicidade de Organize

A operação composta não deve ser:

```text
for object:
  reclassify()
  move()
  editProperty()
  addRelationship()
```

sem preflight global.

Primeiro:

1. planejar tudo;
2. validar todos os objects/destinations;
3. detectar collisions;
4. detectar unsupported operations;
5. mostrar blockers;
6. Apply.

Se V1 não puder fornecer rollback seguro global, usar fail-closed preflight + per-action recovery evidence. Não fingir atomicidade.

---

# 34. Bulk Properties

UI obrigatoriamente baseada em operações explícitas.

Para cada property:

```text
Leave unchanged
Set
Add
Remove
Clear
```

Nunca interpretar empty input como delete.

---

# 35. Property capability intersection

Se seleção contém tipos diferentes:

mostrar somente propriedades cuja operação seja segura para o conjunto.

Exemplo:

```text
12 objects
8 Resource
4 Note
```

`Tags` pode ser comum.

`media_type` não deve aparecer para Notes.

Opcionalmente:

```text
Show properties for Resource only (8)
```

mas isso precisa deixar claro que a operação só atingirá subset.

---

# 36. Relate / Add to

A seleção pode ser relacionada a objeto existente.

Fluxo:

```text
Add 3 objects to...

Search objects...

Relationship
Related to
```

Reutilizar canonical relationship fields/owners.

Não criar `companion_relations`.

Object picker usa o `object-query`/VaultIndex já existente.

---

# 37. Move semantics

Mover fisicamente um arquivo não significa automaticamente mudar tipo.

### Move iniciado por Organizer

Planner entende as consequências na identificação.

### Move manual pelo Obsidian Explorer

Companion observa.

Se move deixou objeto incompatível:

criar Issue.

Não mover o arquivo de volta automaticamente.

---

# 38. Identification mismatch

Exemplo:

```text
Resource rule:
Folder Resources/

user manually moves:
Resources/foo.md
→ Archive/foo.md
```

Issue:

```text
Identification mismatch

foo.md no longer matches the Resource rule.

Keep as Resource
Change type...
Review rule
```

`Keep as Resource` precisa planejar a mudança necessária para satisfazer a Resource TypeSignature, podendo mover de volta apenas após confirmação.

---

# 39. Object Organizer

Adicionar superfície dedicada:

```text
Object Identification

[Overview] [Objects] [Issues] [Rules]
```

Não criar quinta tab “Organizer”.

`Objects` é a superfície de organização global.

---

# 40. Objects tab

Usa VaultIndex/object-query.

Não cria outra indexação.

UI:

```text
Objects                                      1,842

Search...

[All] [Resource] [Task] [Note] [Project] [More]

☐ Vogue V1928        Resource · Sewing
☐ Tailoring Tools    Resource
☐ Random thing       Note                  ⚠
☐ Untitled           Unknown               ?
```

Click abre Universal Detail.

---

# 41. Selection mode

Quando selecionado:

```text
12 selected

Type
Organize
Properties
Add to
Merge
More
```

Toolbar sticky.

Suportar:

- select visible;
- select all results;
- Shift range;
- clear;
- keyboard.

“Select all results” precisa mostrar quantidade real.

---

# 42. Folder Overview

Não criar Folder Note automaticamente.

Abrir uma Quartzo view virtual filtrada por folder.

```text
COSTURA

47 objects

[All] [Resources 31] [Notes 8] [Projects 4] [Unknown 4]

6 need attention                    Review →

Resources
...

Subfolders
Moldes       18
Referências  12
```

---

# 43. Review Folder

Context menu:

```text
Costura/
→ Quartzo
→ Review folder
```

abre Folder Overview com:

- Issues destacados;
- counts;
- actions;
- selection.

---

# 44. Optional semantic drag in Quartzo view

Dentro da **Quartzo Folder Overview**, drag entre buckets pode significar Reclassify.

Exemplo:

```text
Unknown → Resource
```

Isso só vale dentro dessa Quartzo-specific UI.

No File Explorer:

```text
drag = move file
```

Não misturar semânticas.

---

# 45. Issues projection

Criar uma projeção reconstruível, não persisted database.

Categorias V1:

```text
unidentified
ambiguous_identification
identification_mismatch
possible_duplicate
broken_relationship
interrupted_operation
```

---

# 46. Evidence-first Issues

Toda Issue precisa responder:

> Why?

Exemplo:

```text
Ambiguous identification

Matches:
Resource — Property type=resource
Note — Folder Notes/

Resolved as Resource because Resource has higher priority.
```

Não exibir confidence percent arbitrário.

---

# 47. Unidentified

Distinguir:

- ordinary non-object Markdown;
- Markdown que parece Quartzo object incompleto;
- object com ID/type mas signature incompatível.

Não tratar toda nota do vault como “erro” simplesmente por não ser Quartzo object se o produto permite Markdown comum.

---

# 48. Duplicate detection

Candidate detector é projeção.

Nunca auto-merge.

Strong evidence:

- mesmo canonical external ID;
- mesma normalized URL;
- ISBN;
- Google Books ID;
- IMDb ID;
- outros identifiers contratados.

Weak evidence:

- normalized title + same type.

UX:

```text
Possible duplicate

Vogue V1928
Vogue Pattern V1928

Why?
Same normalized URL
Similar title

Compare
Not duplicates
```

---

# 49. “Not duplicates”

Precisa evitar que a mesma sugestão reapareça continuamente.

Persistir uma suppression/evidence somente se existir caminho canônico apropriado.

Não criar banco paralelo silenciosamente.

Se não houver owner canônico para suppression, deixar fora da primeira implementação e documentar.

---

# 50. Review Mode

Workflow keyboard-first para limpeza.

```text
Review issues                       8 / 23

Vogue thing

Currently
Note

Suggested
Resource

Why?
...

[1] Resource
[2] Keep Note
[M] Merge
[E] Edit
[S] Skip
```

Após uma decisão bem-sucedida:

ir imediatamente para a próxima.

`Skip` é UI-session state, não dado canônico.

---

# 51. Organization Inbox

View:

```text
ORGANIZATION INBOX

23 need attention

8 Unidentified
6 Possible duplicates
4 Rule mismatches
3 Ambiguous
2 Broken relationships

Start review
```

Não criar pasta física `Inbox/`.

---

# 52. Overview tab

Mostrar apenas informação acionável.

```text
1,842 objects

23 need attention                    Review →

Objects
Resources 247
Tasks     318
Notes     194

Rules
21 configured
2 with issues

Recent
Merged Sewing → Costura
12 Notes → Resources
```

Sem gráficos decorativos.

---

# 53. Rules tab redesign

Evoluir a UI atual.

Card:

```text
RESOURCE                          247 objects

Identification
Property · type = resource

Appearance
icon + color

245 clean
2 issues

View objects
Edit
```

---

# 54. Rule Editor

Separar claramente:

```text
APPEARANCE
Icon
Color
Emoji
```

e:

```text
IDENTIFICATION
Marker type
Marker value
```

Appearance-only:

- save normal;
- targeted shared settings sync;
- sem content migration.

Structural:

- impact analysis;
- Cancel / Save only / Migrate.

---

# 55. Rule-from-folder action

No folder context menu:

```text
Quartzo
→ Create identification rule from folder...
```

Essa ação **não aplica automaticamente**.

Abre Rule Editor:

```text
Use folder "Costura/" to identify:

[ Resource ▾ ]

This changes the Resource identification rule globally.

247 existing Resources may be affected.

Preview changes
```

---

# 56. Structural migration preview

Exemplo:

```text
Change Resource identification

Current
Property: type=resource

New
Folder: Resources/

247 objects analyzed

231 will move
16 already compatible
0 conflicts

Cancel
Save only
Migrate
```

Esse fluxo deriva do contract existente. 

---

# 57. Merge: usar o owner atual do Quartzo

Não criar um merge semanticamente diferente no Companion.

Primeiro:

- documentar/extrair pure merge planning rules do `MergeService`;
- criar vectors;
- fazer Companion executar os mesmos vectors.

O Quartzo já possui reference repair e rollback-safe local merge. 

---

# 58. Merge Contract V1

Adicionar ao Object Organization Contract:

```text
survivorId
targetType
losingIds
propertyResolutions
bodyResolution
referencePlan
deletePlan
preconditions
```

Merge por ID.

Nunca por title/filename.

---

# 59. Mixed-type merge

Permitir:

```text
Resource + Note + Resource
```

quando planner declarar compatível.

UX:

```text
Merge 3 objects

Final type
Resource

Keep as base
Vogue V1928
Vogue Pattern
V1928
```

**Final type** e **survivor identity** são decisões independentes.

---

# 60. Cross-type conversion antes da destruição

O MergeService atual já bloqueia reconciliation fields que não pertencem ao survivor type e indica que cross-type conversion deve ocorrer antes do destructive merge. 

Portanto:

se:

```text
survivor.type != targetType
```

compor canonical Reclassify/target materialization antes de remover losers.

Não falsificar apenas:

```text
survivor.type = targetType
```

---

# 61. Survivor selection

Alterar UX atual do Quartzo.

Hoje `MergeFlowOrchestrator` escolhe automaticamente o objeto com `updatedAt` mais recente. 

Novo comportamento:

- sugerir survivor;
- usuário pode alterar;
- mostrar razão da sugestão;
- nunca fazer latest-wins silencioso.

Sugestão pode considerar:

- mais references;
- objeto mais completo;
- target type match;
- updatedAt apenas como secondary hint.

Não transformar sugestão em decisão.

---

# 62. Merge property reconciliation

Para cada field:

- iguais → auto-resolved;
- valor em apenas um → sugerir esse valor;
- collections → union com dedupe quando semanticamente válido;
- conflitantes → escolha explícita;
- unknown fields → preservar quando seguro;
- unsupported target fields → blocker ou explicit mapping.

Nunca descartar campo silenciosamente.

---

# 63. Merge custom/unknown fields

A regra de preservação de unknown fields continua válida.

Se loser possui:

```text
custom_property: foo
```

e target serializer pode preservar raw frontmatter:

manter.

Se dois losers têm valores diferentes:

exigir resolução.

Se target contract proíbe o campo:

mostrar blocker.

---

# 64. Merge body

Para tipos com body:

oferecer:

```text
Keep survivor
Use object X
Combine
Custom
```

Quando Combine:

permitir ordenar source bodies.

Drag reorder é UI.

Não determina survivor.

---

# 65. Merge 2-object comparison

Para dois objetos:

usar side-by-side quando pane for larga.

```text
Object A | Object B | Result
```

Em sidebar estreita:

usar stacked comparison.

---

# 66. Merge 3+ objects

Usar summary/reconciliation list.

Não tentar mostrar cinco colunas.

---

# 67. Reference rewrite

Reusar/evoluir `MergeService.repointReferences()`.

O código atual já lida com:

- organizers;
- reference-like frontmatter;
- body WikiLinks;
- links;
- several legacy fields.

Não duplicar a lista no Companion. 

Transformar os casos language-neutral em contract vectors.

---

# 68. Unknown reference representation

Se o planner encontrar referência que não sabe reescrever:

```text
Merge blocked

2 references use an unsupported representation.

Review blockers
```

Não deletar losers.

---

# 69. Delete lifecycle no Merge

Losers devem sair através do canonical delete lifecycle.

O MergeService atual já usa `vaultNotifier.deleteObject()` depois do reference repair e possui rollback se uma fase posterior falhar. 

Companion precisa atingir a mesma semântica.

Não usar:

```text
vault.delete(loser)
```

como substituto simplificado se isso bypassar lifecycle/sync semantics.

---

# 70. Anti-resurrection

Objetivo:

um loser absorvido não pode reaparecer silenciosamente depois que cliente stale reconectar.

Primeiro tentar garantir isso através das regras já canônicas:

- canonical delete lifecycle;
- three-way sync;
- baseline;
- conflict handling;
- survivor aliases/event log;
- reference rewrite.

Não criar tombstone database paralelo automaticamente.

Adicionar vectors obrigatórios:

```text
merge on Companion
Quartzo stale + unchanged loser
→ remote deletion wins according to sync contract

merge on Companion
Quartzo stale + loser edited offline
→ explicit conflict
→ no silent resurrection

same cases reversed
```

Se o protocolo existente não conseguir provar anti-resurrection, **então** evoluir o protocolo canônico/tombstone existente.

---

# 71. Merge event evidence

Preservar o event log atual do survivor.

Evoluir o evento para ser machine-readable se necessário:

```yaml
action: merge
operation_id: ...
absorbed_ids:
  - ...
target_type: resource
```

Mas somente se isso for contratado.

Não usar event log como banco alternativo de objetos.

---

# 72. Merge Undo

Não prometer Undo universal.

Mostrar:

```text
Undo
```

somente quando:

- operation evidence suficiente;
- loser snapshots ainda disponíveis;
- references não mudaram depois;
- current hashes compatíveis;
- restoration pode ser provada.

Caso contrário:

```text
View merge details
```

sem Undo.

---

# 73. Operation history

Manter histórico suficiente para UX/recovery sem criar uma segunda cópia durável do vault.

Pode projetar:

- canonical event evidence;
- recent in-memory operations;
- canonical deleted lifecycle.

Se for necessário um operation sidecar compartilhado, isso exige contrato explícito e justificativa arquitetural.

Não introduzir casualmente.

---

# 74. Editor context menu

Usar `editor-menu`, API pública do Obsidian.

Menu:

```text
Quartzo
  Set object type...
  Edit object properties...
  Add to...
  Find possible duplicates
  Review identification
```

---

# 75. Turn selection into object

Quando editor selection não está vazia:

```text
Quartzo
→ Turn selection into...
   Task
   Idea
   Resource
   Note
```

Não implementar criando objeto ad hoc.

Usar canonical object creation owner.

Fluxo:

1. selected text;
2. choose type;
3. creation review;
4. create object;
5. opcionalmente replace selection with canonical WikiLink.

---

# 76. URL context integration

Obsidian também expõe context event para URLs no API atual.

Quando URL:

```text
Quartzo → Capture as Resource
```

reutilizar Link Capture.

Não criar metadata fetch próprio do editor.

---

# 77. Command Palette

Adicionar commands:

```text
Quartzo: Set selected files as...
Quartzo: Organize selected files
Quartzo: Merge selected objects
Quartzo: Edit selected object properties
Quartzo: Add selected objects to...
Quartzo: Review current folder
Quartzo: Find duplicates in current folder
Quartzo: Open Organization Inbox
Quartzo: Open Object Identification
```

Commands devem chamar os mesmos controllers usados por context menu.

Hotkeys são configuradas pelo Obsidian.

---

# 78. Context-menu clutter

Adicionar submenu `Quartzo`.

Não adicionar dezenas de top-level menu items.

Quick types configuráveis.

A configuração é device-local.

---

# 79. Progress UI

Operações perceptivelmente longas precisam de progresso observável.

Exemplo:

```text
Organizing 417 objects

Planning                    complete
Validating              417 / 417
Applying                 83 / 417
Updating references       8 / 124
Finalizing

Recent activity
Updated Resources/foo.md
```

Percentual apenas com total real.

Essa regra já existe nas guidelines do Companion. 

---

# 80. Não usar Notice como único feedback

Para operação longa:

não basta:

```text
new Notice("Working...")
```

A progress surface precisa sobreviver:

- rerender;
- troca de tab;
- retorno à view.

---

# 81. Recovery

Operação interrompida:

```text
Object organization needs attention

An operation was interrupted after
83 of 417 changes.

Review & recover
```

Recovery deve:

1. carregar operation identity;
2. revalidar current state;
3. reconhecer actions já aplicadas;
4. continuar ou rollback conforme contract;
5. nunca reexecutar tudo cegamente.

---

# 82. Concurrency entre Quartzo e Companion

Testar explicitamente.

### Stale settings preview

Companion planeja revision 42.

Quartzo grava revision 43.

Companion Apply:

```text
Organization changed

This preview was created from an older
Object Identification version.

Refresh preview
```

### Stale object

Hash mudou:

Apply bloqueado.

### Concurrent structural migration

Segundo cliente:

```text
Object organization in progress

Resource identification is being migrated
from another Quartzo client.

View progress
```

Nenhuma segunda migration começa.

---

# 83. Client identity para transition

Se necessário para observabilidade, transition pode guardar:

```text
initiated_by
```

usando device/controller identity existente ou nova identity device-local canônica.

Não usar display device name como segurança.

Não criar ownership last-writer-wins.

---

# 84. Rule edit offline

Se remote/latest revision não puder ser provada:

### Appearance-only

pode ser local pending se contract permitir.

### Structural Save only

preferencialmente requer latest revision.

### Structural Migrate

não pode finalizar cross-client.

UI:

```text
You're offline

You can continue organizing local objects.

Identification rules can't be finalized until
the latest shared revision can be confirmed.
```

---

# 85. Object operations offline

Reclassify/Properties/Move/Merge podem operar localmente se:

- current local preconditions são suficientes;
- não dependem de shared rule mais nova desconhecida;
- client possui latest locally-known rule.

Resultado fica como local vault change.

Quando sync voltar:

normal three-way reconciliation.

---

# 86. Important sync rule

**Object operations do not use Shared Settings Sync to transport object bytes.**

Shared settings targeted reconciliation transporta:

```text
app/quartzo_shared_settings.md
```

somente.

Reclassify/Merge/Move continua sendo content mutation.

Isso impede que Object Identification vire transporte secreto do vault inteiro.

---

# 87. UI status para pending local organization

Quando content sync off:

após operation:

```text
12 objects organized locally

Vault sync is Manual.
These file changes will reach other Quartzo
clients after your next vault sync.

Sync now
```

Se filesystem-synced local-first:

```text
12 objects organized

File transport is handled by your synced vault folder.
```

Não mentir sobre remote completion.

---

# 88. Shared settings status

Mostrar independentemente:

```text
Shared Quartzo settings

Synced
Pending
Local only
Conflict
Authentication required
Transition in progress
```

Não usar full Sync Center count como único indicador.

---

# 89. Shared-settings conflict

Não usar `updated_at` newest-wins.

Com revision divergente:

- three-way/base-aware reconciliation;
- compatible edits podem eventualmente ser merged se contract provar;
- incompatible TypeSignature structural edits → conflict/fail closed.

Não escolher arbitrariamente o mais recente.

---

# 90. Rule transition e parsing

Todos os object parsers que usam TypeSignature precisam entender transition.

Não corrigir apenas uma tela.

Affected layers:

Quartzo:

- shared settings model;
- identification resolver/parser;
- migration service;
- object providers/reindex.

Companion:

- `core/shared-settings`;
- parser/identification;
- index;
- migration planner;
- UI.

---

# 91. Quartzo implementation changes

Esperados, sem assumir nomes novos quando owner existente puder ser estendido:

### Contracts

- Object Organization V1;
- updated Object Identification Migration vectors;
- shared-settings revision/transition vectors;
- merge vectors;
- reference rewrite vectors;
- sync interaction vectors.

### Models

Evoluir `QuartzoSharedSettings`.

### SharedSettingsRepository

Preservar unknown fields.

Adicionar safe revision-aware update API.

### SettingsNotifier

Continuar owner de shared settings projection.

### ObjectIdentificationMigrationService

Adicionar transition-aware planning/application.

### MergeService

Extrair/padronizar pure planning behavior para cross-client vectors.

### MergeFlowOrchestrator

Escolha explícita de survivor + target type.

### VaultNotifier

Continuar lifecycle owner de create/update/delete/restore.

### SyncManager

Adicionar targeted shared-settings reconciliation no owner existente.

Não criar `ObjectOrganizationSyncManager`.

---

# 92. Companion implementation changes

### Core

Adicionar/evoluir:

```text
object-organization/
```

apenas como domain planning/policy, não persistence paralela.

Responsabilidades:

- scope-independent operation plans;
- contract vector parity;
- capability resolution.

### Vault

Reutilizar:

- `SafeObjectMutationRepository`;
- `ObjectIdentificationMigrationRepository`;
- existing Vault APIs/index.

Adicionar adapter específico apenas quando nenhum canonical repository cobre a operação.

### SharedSettingsRepository

Adicionar revision-aware compare-before-write.

### Sync coordinator

Adicionar targeted shared-settings path reconciliation.

### UI

Adicionar:

- context menus;
- Object Identification tabs;
- Folder Overview;
- Organization Inbox;
- Review Mode;
- operation modals;
- progress/recovery surfaces.

---

# 93. Não colocar domínio em `main.ts`

O Companion `main.ts` continua lifecycle/wiring.

Não implementar toda a feature diretamente nele.

Context-menu registration pode ser wired por `main.ts`, mas:

- scope resolution;
- planning;
- merge;
- reclassification;
- UI flows

ficam nos respectivos modules.

---

# 94. Object Organization UI architecture sugerida

```text
src/ui/object-organization/
  overview/
  objects/
  issues/
  rules/
  folder-overview/
  review/
  modals/
    set-type
    organize
    bulk-properties
    relate
    merge
    rule-migration
  components/
```

Ajustar nomes aos patterns já existentes.

Não refatorar unrelated UI apenas para atingir essa estrutura.

---

# 95. Universal reusable picker

Usar owner de query existente.

Um picker pode aceitar:

```text
allowedTypes
excludedIds
multiple?
```

Reutilizar para:

- Add to;
- relationships;
- target selection;
- merge-into future flow.

Não criar searches diferentes.

---

# 96. “Merge into…” future-compatible design

Embora não seja obrigatório no primeiro shipping slice, contract/UI não devem impedir:

```text
select A B C
→ Merge into...
→ choose existing D
```

V1 pode limitar merge aos objetos selecionados se necessário.

Documentar a limitação explicitamente.

---

# 97. Object type capability

Nem todos os tipos precisam permitir todas as operações.

Contract deve permitir capability matrix:

```text
reclassify
bulkProperties
mergeAsSource
mergeAsTarget
bodyMerge
relationships
```

UI não decide com switch próprio.

---

# 98. Merge compatibility

Mixed-type merge não significa “qualquer coisa com qualquer coisa”.

Planner decide.

Exemplo:

- Note → Resource pode ser compatível;
- Entry → Resource talvez precise body mapping;
- System → Resource provavelmente bloqueado;
- `daily_note` continua fora de mutation simplificada.

Capabilities derivadas do contract.

---

# 99. No silent partial bulk success

Default:

se preflight encontra blocker estrutural:

não começar.

Durante I/O failure após Apply começar:

- registrar progresso;
- recovery path;
- UI mostra exatamente quantos concluíram.

Não retornar apenas:

```text
11 succeeded, 1 failed
```

e esquecer o estado.

---

# 100. Destructive-operation friction proporcional

### Single safe mutation

pode ser rápida.

### Bulk mutation

summary + preview.

### Rule migration

impact analysis + preview.

### Merge

survivor + target type + conflict reconciliation + final preview.

Não mostrar três confirmações para um Set Type simples.

---

# 101. UX wording

Todo texto de produto deve ser em English, de acordo com guidelines.

Exemplos:

```text
Set object type
Organize objects
Review folder
Possible duplicates
Identification mismatch
Shared settings
```

A spec pode permanecer em português.

---

# 102. Responsive behavior

### Wide main pane

list + inspector pode coexistir.

### Narrow sidebar

usar one-column navigation.

Merge comparison:

- side-by-side quando espaço;
- stacked quando narrow.

Nenhuma operação depende exclusivamente de hover.

---

# 103. Keyboard UX

Implementar:

- Shift selection;
- Escape clear/close;
- Space selection onde padrão da view permitir;
- visible focus;
- Review Mode shortcuts;
- Command Palette alternatives.

Destructive final action não deve ser single-key sem protection.

---

# 104. Accessibility

- menu items com labels claros;
- status não apenas por cor;
- focus return após modal;
- ARIA quando DOM custom;
- loading/progress announced;
- keyboard reachability;
- error text persistente para blockers.

---

# 105. Performance

Não reparsear o vault inteiro:

- a cada checkbox;
- a cada menu open;
- a cada filter.

Inventory/Objects usa VaultIndex.

Full scans só quando operation preflight realmente exige.

Folder scope usa vault paths/index incremental.

---

# 106. Folder counters

Evitar calcular recursive counts com N independent full queries.

Criar uma projection eficiente sobre o índice.

Não persistir counters.

---

# 107. Large merge/reference scan

Exibir progress.

Pode ser cancelável somente enquanto ainda estiver na fase puramente read-only de planning.

Depois do primeiro mutation:

não oferecer Cancel se rollback/cancel safety não estiver comprovada.

---

# 108. Sync interaction com rename/move

Object Organization não precisa ensinar sync sobre `Reclassify`.

Resultado de Reclassify pode ser:

```text
edit
rename
```

Sync transporta esses fatos existentes.

Resultado de Merge:

```text
survivor edit
reference edits
loser deletes
```

Sync transporta esses fatos.

Só mudar sync protocol se os testes revelarem que esses conjuntos não convergem corretamente.

---

# 109. Sync interaction com operation ordering

Quando uma operação local produz vários writes:

eles devem entrar no sync somente depois do local transaction/recovery boundary definido.

O MergeService atual já procura fazer file updates entrarem em sync depois do local merge transaction. Preservar essa propriedade. 

---

# 110. Shared Settings targeted sync e object operation não devem deadlockar

Exemplo:

1. rule migration begins;
2. transition shared-settings sync;
3. object writes;
4. content sync;
5. commit shared settings.

Coordinator needs explicit sequencing.

Não adquirir locks em ordem diferente nos dois clientes.

Documentar lock ordering.

---

# 111. Required lock ordering

Definir uma ordem canônica, por exemplo:

```text
organization operation
→ shared-settings transition
→ local vault mutations
→ content transport
→ shared-settings commit
```

A implementação concreta pode variar, mas Dart/TS não podem inverter owner order e causar deadlock/race.

---

# 112. Object Identification reload

Quando shared settings mudar por:

- local edit;
- targeted Drive sync;
- full sync;
- filesystem change;

executar:

1. parse/validate settings;
2. replace projection atomically;
3. reindex affected objects;
4. rerender Object Identification/Organizer.

Não misturar old settings com partially refreshed index.

---

# 113. Invalid shared settings

Fail closed.

UI:

```text
Shared Object Identification could not be loaded.

Objects are not being reorganized automatically.

View details
```

Não resetar silenciosamente para defaults e reclassificar o vault.

---

# 114. Rule priority UX

Current Object Identification already uses type priority for conflict resolution. 

Rules tab pode permitir reorder através do owner existente.

Issues devem explicar quando priority resolveu um conflito.

Não usar priority para esconder a existência do conflito.

---

# 115. File Explorer badges — optional polish

Pode adicionar depois do core:

- identification issue badge;
- optional type icon.

Setting:

```text
File Explorer integration

Show identification issues
Show Quartzo object type icons
```

Não usar DOM brittle mutation se Obsidian não oferecer extensão segura.

Esta feature é polish, não blocker V1.

---

# 116. Object-type icon/color

Sempre usar TypeSignature compartilhada.

Não manter color/icon map local no Organizer.

---

# 117. Recent organization

Overview pode mostrar recent operations somente se dados forem confiáveis.

Se não houver history owner durável:

mostrar apenas operations da sessão atual.

Não inventar persistence.

---

# 118. Privacy

Object Organization não deve mostrar Journal/body previews se existing privacy mode os ocultaria.

Folder Overview/Issue cards devem respeitar:

- sensitive previews;
- journal preview settings.

---

# 119. Security

- nenhum external text em unsafe `innerHTML`;
- filenames/titles/metadata via text nodes;
- URL capture só pelo secure remote-fetch boundary;
- no arbitrary script;
- no `custom_script`.

---

# 120. Test contracts — Reclassify

Vectors:

- property → property;
- property → tag;
- tag → property;
- folder → property;
- property → folder;
- folder → folder;
- conflicting marker removal;
- unknown fields;
- malformed YAML blocker;
- destination exists;
- duplicate destination;
- stale hash;
- retry after partial I/O;
- ID preserved;
- body preserved.

---

# 121. Test contracts — Rule transition

Vectors:

```text
ACTIVE old
old object → resolves

TRANSITION
old object → target type
new object → target type
old+new markers → same target without false conflict

COMMITTED new
new object → target
old-only object → issue/mismatch
```

---

# 122. Test contracts — Merge

Vectors:

- same-type merge;
- mixed-type merge;
- survivor type == target;
- survivor requires reclassify;
- unknown fields;
- conflicting unknown fields;
- body combine;
- reference rewrite;
- ambiguous legacy reference;
- unsupported reference blocker;
- loser delete;
- rollback after failed reference rewrite;
- rollback after failed survivor save;
- retry;
- event evidence.

---

# 123. Test contracts — anti-resurrection

At minimum:

```text
A and B synced
Companion merges B into A
Quartzo still has B unchanged
sync
→ B remains deleted/retired

Quartzo edited B offline after merge
sync
→ explicit conflict
→ B not silently recreated as live canonical object
```

Reverse clients too.

---

# 124. Test contracts — scope

- one file;
- folder direct;
- folder recursive;
- overlapping folders;
- file already contained by selected folder;
- files-menu mixed selection;
- attachment ignored;
- `.base` ignored for object mutation;
- unidentified Markdown included correctly;
- `_deleted` excluded;
- archived according to operation semantics.

---

# 125. Test contracts — bulk properties

- leave unchanged;
- set;
- add;
- remove;
- clear;
- mixed types;
- unsupported property;
- unknown field preservation;
- empty string distinction;
- explicit null/clear distinction.

---

# 126. Test contracts — sync modes

Automate as much as possible:

### Content Automatic
object + settings converge.

### Content Manual
settings targeted sync converges;
object mutations remain pending.

### Local-first filesystem
filesystem settings change reloads/reindexes.

### Local-only
no false “Synced”.

### Offline transition
does not commit incompatible rule.

### Reconnect
pending transition resumes safely.

---

# 127. UI tests

Cover:

- context menu appears for TFile;
- folder menu;
- `files-menu` multi-selection;
- disabled Merge when <2 eligible;
- direct vs recursive;
- quick types;
- stale preview error;
- progress;
- narrow pane;
- keyboard Review Mode;
- dark/light;
- long filenames;
- 0 objects;
- 1,000+ results;
- privacy.

---

# 128. Architecture gates

Adicionar gates automáticos para impedir regressões.

Exemplos:

- UI cannot directly rewrite Markdown for organization;
- UI cannot instantiate Drive API for settings sync;
- no second object index;
- no `ObjectOrganizationSync*`;
- no direct destructive `vault.delete()` in merge UI;
- Companion merge must route through contracted owner;
- Rules UI cannot enumerate/write migration candidates itself;
- Folder selection cannot mutate TypeSignature unless explicit Rule action.

---

# 129. Guidelines updates

Adicionar regras permanentes:

1. **Selection scope is not an identification rule.**
2. **Reclassify mutates objects to satisfy an existing TypeSignature; it never edits TypeSignature.**
3. **Structural TypeSignature migration uses revision + transition and cannot finalize while dependent content transport is unresolved.**
4. **Shared Object Identification may reconcile independently of full vault content sync, but uses the same canonical shared-settings file and existing sync coordinator.**
5. **Object Organization operations never create a second canonical object store.**
6. **Merge is ID-based and cross-type merge requires explicit target type + survivor + reconciliation.**
7. **Manual File Explorer moves are respected; mismatch becomes Issue instead of automatic move-back.**

---

# 130. Agents updates

Document owner map.

Expected conceptual ownership:

```text
Shared settings persistence
→ SharedSettingsRepository / SettingsNotifier

Identification
→ TypeSignature/shared identification resolver

Structural migration
→ ObjectIdentificationMigration owner

Safe field mutation
→ canonical object mutation owner

Merge
→ MergeService / contracted TS parity

Vault lifecycle
→ VaultNotifier / Companion vault adapter

Sync
→ existing SyncManager / DriveSyncCoordinator

Queries
→ existing allObjects/VaultIndex/object-query

UI
→ consumers only
```

---

# 131. New active spec

Salvar esta spec no Quartzo como canonical active spec, por exemplo:

```text
docs/specs/object-organization.md
```

Companion deve ter pointer/vendor contract conforme arquitetura atual.

Não deixar esta decisão apenas em chat.

---

# 132. Implementation slices

Executar em slices, cada um verde antes de seguir.

## Slice A — Contract foundation

Quartzo:

- active spec;
- contract;
- shared-settings revision;
- transition model;
- vectors.

Companion:

- vendor;
- parser parity;
- contract gates.

No UI yet.

## Slice B — targeted shared settings

Quartzo + Companion:

- targeted path reconciliation;
- reload/reindex;
- mode/status semantics.

Provar content sync on/off.

## Slice C — Reclassify

- canonical planner;
- Dart implementation;
- TS parity;
- tests.

## Slice D — Obsidian native selection

- `file-menu`;
- `files-menu`;
- folder scope resolver;
- Set Type.

Este é o primeiro grande UX deliverable.

## Slice E — Bulk Properties + Organize

- operation planner;
- composed preview;
- progress.

## Slice F — Relationships

- Add to;
- picker;
- relationship mutations.

## Slice G — Objects / Issues

- tabs;
- inventory;
- evidence;
- selection mode.

## Slice H — Folder Overview + Review Mode

- folder surface;
- Inbox;
- keyboard workflow.

## Slice I — Rules migration UX

- revision/transition full UX;
- Save only/Migrate;
- offline/pending transport.

## Slice J — Merge contracts

- extract existing Quartzo semantics;
- vectors;
- explicit survivor;
- cross-type plan.

## Slice K — Companion Merge

- multi-selection Merge;
- reconciliation;
- references;
- canonical delete parity.

## Slice L — Editor/URL/commands

- editor menu;
- Turn selection into;
- URL Link Capture;
- Command Palette.

## Slice M — quality closure

- recovery;
- anti-resurrection;
- races;
- accessibility;
- performance;
- cross-client E2E.

---

# 133. Required UI flow — Set folder objects as Resource

User:

```text
right click Costura/
→ Quartzo
→ Set objects as...
```

Modal:

```text
Set object type

Folder
Costura/

Scope
● This folder only             12
○ Include subfolders           47

Set as
Resource

Current identification
7 Resource
3 Note
1 Project
1 Unidentified

This changes these objects.
It does not change the Resource identification rule.

Preview
```

Preview:

```text
12 objects

Already Resource                   7
Will become Resource               5

Changes
4 marker updates
2 moves
0 conflicts

Apply
```

---

# 134. Required UI flow — Multi-select Merge

User selects:

```text
Vogue V1928.md
Vogue Pattern.md
V1928.md
```

Right-click:

```text
Quartzo → Merge objects...
```

Step 1:

```text
Merge 3 objects

Final type
Resource

Keep as base
● Vogue V1928
○ Vogue Pattern
○ V1928

Continue
```

Step 2:

property reconciliation.

Step 3:

body reconciliation if relevant.

Step 4:

references.

```text
55 references will be redirected
```

Step 5:

final preview.

```text
1 object survives
2 objects absorbed
55 references redirected
0 blockers

Merge objects
```

---

# 135. Required UI flow — Organize Inbox files

```text
select 10 Inbox files
→ Quartzo → Organize...
```

```text
Type
Resource

Move to
Resources/Sewing/

Category
Add Sewing

Organizer
Costura
```

Preview all effects.

Apply one operation.

---

# 136. Required UI flow — manual move causes mismatch

User drags:

```text
Resources/foo.md
→ Archive/foo.md
```

No automatic reversal.

Issue appears:

```text
foo.md no longer matches its Resource identification rule.

Keep as Resource
Change type...
Review Resource rule
```

---

# 137. Required UI flow — Rule migration while content sync Manual

User changes:

```text
Resource
Property → Folder
```

Selects `Migrate`.

If Companion paired but content sync Manual:

```text
This migration changes 247 files.

Shared settings can sync independently,
but these object changes require vault transport
before the new rule can be finalized on other clients.

Options:
Migrate locally and sync now
Cancel
```

If architecture allows pending transition:

```text
Migrate locally
Rule will remain "Transition in progress"
until object changes are synchronized.
```

Do not silently publish ACTIVE final rule.

---

# 138. Required UI flow — shared settings changed elsewhere

Companion modal open on revision 42.

Quartzo updates rule.

Apply:

```text
Object Identification changed

This preview was based on revision 42.
The current revision is 43.

Refresh preview
```

---

# 139. Required UI flow — external migration detected

Companion opens:

```text
Object organization in progress

Resource identification is being migrated
from another Quartzo client.

231 / 247 objects

Object Identification structural editing
is temporarily unavailable.

View details
```

---

# 140. Cross-client E2E acceptance

Must prove:

1. Companion starts with vault sync Manual.
2. Change Resource icon in Companion.
3. targeted shared settings reaches Quartzo.
4. no full content sync was triggered.
5. Quartzo changes Resource color.
6. Companion reloads it.
7. Companion selects folder and sets objects to Resource.
8. rule does not change.
9. with content sync still Manual, Quartzo remote object bytes remain unchanged.
10. `Sync now`.
11. Quartzo sees reclassified objects.
12. Quartzo does not revert them.
13. Companion changes structural Resource rule with Migrate.
14. transition appears cross-client.
15. migrated content syncs.
16. transition commits.
17. both identify same objects.
18. Companion merges mixed Note + Resource into Resource.
19. choose survivor explicitly.
20. references rewrite.
21. Quartzo sees survivor.
22. losers do not return.
23. reverse operation initiated by Quartzo produces same Companion result.
24. stale offline edit produces conflict rather than silent loss/resurrection.

---

# 141. V1 completion definition

Object Organization V1 is complete only when:

- Object Identification remains one shared source.
- Shared settings can reconcile independently of full content sync where remote transport is available.
- Reclassify does not alter rules.
- Folder selection does not imply a rule.
- File Explorer single/multi/folder flows work using public APIs.
- Bulk Properties is safe.
- Organize composite operation works.
- Folder Overview works.
- Objects/Issues/Rules work.
- Review Mode works.
- Rule migrations are revision/transition safe.
- Merge reuses canonical Quartzo semantics.
- mixed-type Merge supports explicit target type.
- survivor is explicit.
- references are safe.
- losers do not silently resurrect.
- offline/manual sync behavior is understandable.
- stale previews fail closed.
- interrupted operations recover.
- no data loss of unknown fields.
- no second store/index/sync engine exists.
- Quartzo and Companion contract vectors agree.
- all relevant Flutter/TS tests and gates are green.

---

# 142. Explicit non-goals

Do not turn this project into:

- automatic AI vault organizer;
- auto-merge system;
- fuzzy autonomous reclassification;
- new database;
- new sync protocol unrelated to the existing one;
- automatic folder-to-type inference;
- automatic correction of manual file moves;
- automatic deletion of duplicate candidates;
- generic binary attachment conversion;
- full Obsidian replacement UI;
- DOM-hacked File Explorer fork.

---

# 143. Final implementation rule

Whenever implementation faces a choice between:

```text
a convenient Companion-only shortcut
```

and:

```text
a contracted operation that Quartzo can reproduce
```

choose the second.

The purpose of this feature is not merely to provide bulk UI.

Its defining requirement is:

> **An organization decision made from the Obsidian Companion must become a canonical Quartzo decision, survive sync/offline/restart, remain understandable on both clients, and never be undone merely because another client parsed the vault later.**

END OF SPEC

## Organization Issues — bulk delete / canonical retirement

- Multi-select in Organization Issues may delete multiple ordinary Markdown subjects in one explicit confirmation. Selection scope is presentation only and does not alter Object Identification rules.
- Delete is a canonical retirement, never a raw filesystem delete: each selected file is rewritten to a minimal `type: _deleted` tombstone and moved to `_deleted/<object-id>.md`. Merge losers reuse the same lifecycle.
- `_deleted/**` participates in vault content sync so deletion state is transportable, but tombstones are excluded from the live Organization Issues projection.
- In paired Drive mode, deletion preflight must prove each tracked remote is still the same path and same baseline hash; untracked/ambiguous remote identity blocks deletion until normal sync establishes a safe baseline.
- The coordinator revalidates the remote hash again immediately before applying a queued rename. If Drive changed concurrently, it keeps the rename pending and creates an explicit conflict; it never pulls the old source path back over a pending retirement.
- A safe remote rename preserves the existing `remoteFileId`, then normal local-dirty processing updates that same remote file with tombstone bytes. Manual mode persists the queued rename until `Sync now`; automatic mode may reconcile through the existing coordinator.
- UI must show destructive confirmation, affected paths, sync-safety blockers, and partial-failure state. It must not create a second delete registry, database, sync engine, or source of truth.
