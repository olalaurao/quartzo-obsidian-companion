# Quartzo Obsidian Companion V1

O Quartzo Companion é um plugin para Obsidian Desktop que atua como segundo cliente oficial do Quartzo, compartilhando o mesmo vault canônico Markdown/YAML. Funciona local-first sem pairing obrigatório quando o vault já está numa pasta sincronizada pelo sistema de arquivos.

## Visão geral

- **Desktop only**: Windows, macOS e Linux.
- **Mesmo vault canônico**: objetos continuam em Markdown + YAML, sem banco de dados canônico paralelo.
- **Vault com Google Drive Desktop ou outra pasta sincronizada**: trabalha diretamente nos arquivos locais, sem exigir pairing via API; o provedor do filesystem transporta as mudanças.
- **Vault local sem transporte por filesystem**: pairing e reconciliação three-way do Drive são uma opção explícita.
- **Sync manual por padrão**: `Manual` não faz sync em startup, foco, polling ou mudanças locais; `Sync now` e full reconciliation continuam disponíveis. `Automatic` é opt-in.
- **Offline-first**: o trabalho local não depende de conexão contínua; a reconciliação ocorre quando o Drive está disponível.
- **Uma shell Quartzo**: Home, Planner, Journal, Browse e Activity, com Search, Add, Sync e Settings como ações.

## Comportamento offline e modos de sync

- **Manual**: nunca faz reconciliação por startup/focus/polling/evento; `Sync now` e resolução de conflitos são explícitos. O estado local é hidratado ao iniciar.
- **Automatic**: usa gatilhos do mesmo `DriveSyncCoordinator`, sem scheduler paralelo.
- **Offline**: operações locais disponíveis conforme contratos; mudanças remotas aguardam conexão. Não declarar sucesso de transporte offline.
- **Sem pairing**: Home, Browse, edição e indexação locais não exigem conexão Google se o filesystem já sincroniza o vault.

## Object Identification

O Companion usa `app/quartzo_shared_settings.md` como a mesma fonte cross-client de Object Identification usada pelo Quartzo mobile. Alterações de marker, prioridade, cor ou ícone feitas no Quartzo são recarregadas pelo Companion após mudança no filesystem/sync; alterações feitas nas Settings do Companion escrevem o mesmo documento do vault e disparam reindexação local.

`Type Conflicts` é uma superfície de identificação de objeto, não o Sync Conflict Center. Ela lista arquivos que satisfazem markers incompatíveis, mostra o tipo vencedor pela prioridade compartilhada e oferece apenas correções localmente seguras, como remover um marker de tag/propriedade conflitante. Conflitos que exigem conversão de schema ou move de arquivo sem política segura permanecem em `Open Markdown`.

## Limitações do V1

- Reminders são best effort e só podem ser entregues enquanto o Obsidian estiver aberto.
- `custom_script`, execução automática de Systems e daemons externos não são suportados.
- `daily_note` permanece bruto/read-only no Companion até existir contrato de parser/serializer próprio.
- Google Calendar, quando habilitado, é uma projeção read-only; o Companion não cria, edita nem apaga eventos no V1.
- Tipos sem mutation contract completo devem abrir em modo seguro/Markdown em vez de ganhar um editor simplificado que possa perder dados.

## Instalação via BRAT

O repositório é público; não é necessário PAT do GitHub para instalar o beta.

1. Instale e habilite o plugin BRAT no Obsidian.
2. No BRAT, escolha **Add Beta plugin**.
3. Informe `olalaurao/quartzo-obsidian-companion`.
4. Instale a release estável mais recente.
5. Habilite **Quartzo Companion** em Community plugins.

A distribuição deve usar uma release validada pelo CI contendo `main.js`, `manifest.json`, `styles.css` e `SHA256SUMS.txt`. Não use um `main.js` local não validado como release.

## Documentação para agentes

Comece por [`AGENT_BOOTSTRAP.md`](AGENT_BOOTSTRAP.md), consulte o [`docs/README.md`](docs/README.md), os contratos vendorados e só as seções aplicáveis de [`guidelines.md`](guidelines.md) e [`agents.md`](agents.md). Os detalhes de sync estão em [`docs/specs/drive-sync-operational.md`](docs/specs/drive-sync-operational.md). Planos históricos não prevalecem sobre contratos atuais.

## Desenvolvimento e testes

O repositório mantém uma cópia pinada dos contratos/fixtures canônicos do upstream `olalaurao/aplicativo`. O `contracts/UPSTREAM.lock.json` registra o commit upstream e os hashes esperados.

Mudanças cross-client em tipos de vault, aliases persistidos, campos, regras de Object Identification, TypeSignature, fixtures ou mutation support devem nascer no upstream `olalaurao/aplicativo`, atualizar os contratos/fixtures e só então ser vendorizadas no Companion. O Companion roda contra contratos empacotados e não baixa schema em runtime.

```bash
npm ci
npm run docs:check
npm run contracts:verify
npm run typecheck
npm run lint
npm test
npm run test:contracts
npm run test:sync
npm run architecture:check
npm run build
npm run release:validate
npm run smoke:clean-artifact
npm run release:package
```

## Releases

A tag da release, a versão do `package.json` e a versão do `manifest.json` devem coincidir. O GitHub Actions recompila e valida o artefato antes de publicar a release.

O build de release exige `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID` e `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET` configurados como GitHub Actions secrets para o mesmo cliente OAuth do tipo Desktop app. O Companion usa loopback `127.0.0.1` com PKCE e envia a credential exigida pelo token endpoint do Google; tokens OAuth do usuário nunca são empacotados e permanecem no `SecretStorage` do Obsidian.

O escopo completo de suporte V1 está em [`docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md`](docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md).

Antes de criar uma tag, execute manualmente o workflow **Release Preflight** em `main`. O passo a passo completo de Google Cloud, preflight, publicação e BRAT está em [`docs/BETA_RELEASE_RUNBOOK.md`](docs/BETA_RELEASE_RUNBOOK.md).
