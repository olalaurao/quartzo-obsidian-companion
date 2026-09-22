# Quartzo Obsidian Companion V1

O Quartzo Companion é um plugin para Obsidian Desktop que atua como segundo cliente oficial do Quartzo, compartilhando o mesmo vault canônico via Google Drive.

## Visão geral

- **Desktop only**: Windows, macOS e Linux.
- **Mesmo vault canônico**: objetos continuam em Markdown + YAML, sem banco de dados canônico paralelo.
- **Google Drive Sync**: pareia explicitamente com um vault Quartzo remoto existente e usa reconciliação three-way.
- **Sync manual por padrão**: `Manual` não faz sync em startup, foco, polling ou mudanças locais; `Sync now` e full reconciliation continuam disponíveis. `Automatic` é opt-in.
- **Offline-first**: o trabalho local não depende de conexão contínua; a reconciliação ocorre quando o Drive está disponível.
- **Uma shell Quartzo**: Home, Planner, Journal e Browse, com Search, Add, Sync e Settings como ações.

## Limitações do V1

- Reminders são best effort e só podem ser entregues enquanto o Obsidian estiver aberto.
- `custom_script`, execução automática de Systems e daemons externos não são suportados.
- `daily_note` permanece bruto/read-only no Companion até existir contrato de parser/serializer próprio.
- Google Calendar, quando habilitado, é uma projeção read-only; o Companion não cria, edita nem apaga eventos no V1.
- Tipos sem mutation contract completo devem abrir em modo seguro/Markdown em vez de ganhar um editor simplificado que possa perder dados.

## Instalação via BRAT — beta

O repositório é público; não é necessário PAT do GitHub para instalar o beta.

1. Instale e habilite o plugin BRAT no Obsidian.
2. No BRAT, escolha **Add Beta plugin**.
3. Informe `olalaurao/quartzo-obsidian-companion`.
4. Instale a release beta disponível.
5. Habilite **Quartzo Companion** em Community plugins.

A distribuição beta deve usar uma release validada pelo CI contendo `main.js`, `manifest.json` e `styles.css` quando aplicável. Não use um `main.js` local não validado como release.

## Desenvolvimento e testes

O repositório mantém uma cópia pinada dos contratos/fixtures canônicos do upstream `olalaurao/aplicativo`. O `contracts/UPSTREAM.lock.json` registra o commit upstream e os hashes esperados.

```bash
npm ci
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

A tag da release, a versão do `package.json` e a versão do `manifest.json` devem coincidir. O GitHub Actions recompila e valida o artefato antes de publicar a prerelease.

O build de release exige apenas `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID` configurado como GitHub Actions secret para o cliente OAuth do tipo Desktop app. O Companion usa loopback `127.0.0.1` com PKCE e não configura, envia nem empacota Client Secret para esse cliente público; tokens OAuth do usuário nunca são empacotados e permanecem no `SecretStorage` do Obsidian.

O escopo completo de suporte V1 está em [`docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md`](docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md).

Antes de criar uma tag, execute manualmente o workflow **Release Preflight** em `main`. O passo a passo completo de Google Cloud, preflight, publicação e BRAT está em [`docs/BETA_RELEASE_RUNBOOK.md`](docs/BETA_RELEASE_RUNBOOK.md).
