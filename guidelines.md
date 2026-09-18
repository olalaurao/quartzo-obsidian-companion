# Quartzo Companion Guidelines

Estas regras são permanentes para o desenvolvimento do Quartzo Obsidian Companion:

1. **Fonte Canônica:** O repositório upstream `olalaurao/aplicativo` é a fonte canônica. Todas as regras de negócio e contratos de dados derivam dele.
2. **Object Interop:** Objetos usam frontmatter YAML + Markdown body. Preserve chaves e campos desconhecidos.
3. **Sem Caches Canônicos:** Não crie banco de dados SQLite secundário para dados canônicos. Índices locais são apenas projeções reconstruíveis.
4. **Sem Ferramentas Externas:** O ambiente não deve exigir Node.js, Python ou daemons locais fora do Obsidian.
5. **Typescript Rigoroso:** Utilize TypeScript Strict, sem type casting cego de objetos brutos.
6. **Sincronização:** Todas as ações de sincronização com o Google Drive devem utilizar "three-way reconciliation" baseado no baseline e nos hashes.
7. **Modo de sync:** O Companion expõe um único modo local de sincronização: `Manual` ou `Automatic`. `Manual` é o padrão e não pode disparar reconciliação por startup, foco, polling ou evento local; `Sync now`, conflitos e full reconciliation continuam disponíveis. `Automatic` habilita esses gatilhos através do mesmo coordenador canônico.

8. **Limpeza de identidade ambígua no pairing:** o Companion só pode oferecer limpeza automática de candidatos duplicados após ação explícita do usuário e prova por SHA-256 de que a remoção é segura. A ação deve revalidar o snapshot local/remoto imediatamente antes da mutação, mover candidatos apenas para a Lixeira do Google Drive (nunca apagar permanentemente) e manter pelo menos um candidato canônico por caminho. Caminhos sem resolução inequívoca permanecem bloqueados para revisão manual.

9. **Quota temporária do Drive:** pairing/sync explícitos não devem tratar limite temporário por minuto da API do Google Drive como falha de autenticação. O cliente deve aguardar/repetir com backoff sem fazer mutações inseguras; uma nova tentativa não deve desperdiçar trabalho já comprovado de arquivos remotos inalterados.
