# Agents - Companion Architecture

A arquitetura do Companion é dividida nestas camadas:

- **core**: Parsing de objetos, Scheduler, Daily Schedule, Occurrences. Esta camada não depende do Obsidian nem do DOM, idealmente permitindo testes 100% isolados.
- **vault**: Integração com Obsidian. Observa arquivos locais, manipula parse/write e indexação derivadas.
- **sync**: Implementa reconciliação do Drive (push, pull, conflict, baselines) usando estado local isolado.
- **integrations**: Google Auth Loopback para Desktop (sem webview), chamadas à API Drive V3.
- **platform**: Helpers de Obsidian, Lifecycle, Secrets, Notificações do sistema.
- **ui**: Shell do plugin, Home, Planner, Journal, Search, Configurações. Usar Vanilla DOM via Obsidian API, sem react/vue/svelte (a não ser que documentado ganho real).
- **local-state**: Abstração do estado de sincronização e token cache, armazenado localmente (`data.json` para pequeno, file-backed cache para sync queue).
