# Agents - Companion Architecture

A arquitetura do Companion é dividida nestas camadas:

- **core**: Parsing de objetos, Scheduler, Daily Schedule, Occurrences. Esta camada não depende do Obsidian nem do DOM, idealmente permitindo testes 100% isolados.
- **vault**: Integração com Obsidian. Observa arquivos locais, manipula parse/write e indexação derivadas.
- **sync**: Implementa reconciliação do Drive (push, pull, conflict, baselines) usando estado local isolado.
- **integrations**: Google Auth Loopback para Desktop (sem webview), chamadas à API Drive V3.
- **platform**: Helpers de Obsidian, Lifecycle, Secrets, Notificações do sistema.
- **ui**: Shell do plugin, Home, Planner, Journal, Search, Configurações. Usar Vanilla DOM via Obsidian API, sem react/vue/svelte (a não ser que documentado ganho real).
- **local-state**: Abstração do estado de sincronização e token cache, armazenado localmente (`data.json` para pequeno, file-backed cache para sync queue).

- **OAuth loopback:** O listener desktop deve validar `state` somente em respostas que sejam callbacks OAuth reais. Requests auxiliares do navegador (por exemplo `/favicon.ico`) devem ser ignorados/retornar 404 sem consumir, rejeitar ou encerrar o fluxo de autenticação ativo.

- **OAuth Desktop credentials:** Drive e Calendar devem usar o mesmo `GoogleOAuthDesktop` canônico. O token exchange e o refresh devem enviar `client_id` + a client credential do mesmo Google Desktop OAuth client, mantendo PKCE S256. Release/preflight devem falhar se qualquer uma das duas credenciais de build estiver ausente. Não criar fluxo OAuth paralelo para Calendar/Drive nem commitar valores reais no repositório.

- **Obsidian SecretStorage IDs:** todos os IDs usados em `app.secretStorage` devem vir do owner canônico `src/platform/secret-ids.ts` e obedecer `^[a-z0-9-]{1,64}$` (somente minúsculas, números e hífens; máximo 64 caracteres). Não usar `_`, `/`, espaços ou IDs ad hoc em integrações.

- **Large-vault pairing:** initial pairing must stay linear in the number of vault files. A recursive Drive inventory carries the canonical vault-relative path so pairing/full inventory do not issue parent-metadata requests per file. Pairing may refresh the remote inventory once before mutation, but must never re-run `listAllFiles()` once per local-only or remote-only item. Remote-only classification must not download/hash file bodies until a pull is actually requested. Pairing UI must show an in-progress state while scanning.
