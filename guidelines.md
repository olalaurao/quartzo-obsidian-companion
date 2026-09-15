# Quartzo Companion Guidelines

Estas regras são permanentes para o desenvolvimento do Quartzo Obsidian Companion:

1. **Fonte Canônica:** O repositório upstream `olalaurao/aplicativo` é a fonte canônica. Todas as regras de negócio e contratos de dados derivam dele.
2. **Object Interop:** Objetos usam frontmatter YAML + Markdown body. Preserve chaves e campos desconhecidos.
3. **Sem Caches Canônicos:** Não crie banco de dados SQLite secundário para dados canônicos. Índices locais são apenas projeções reconstruíveis.
4. **Sem Ferramentas Externas:** O ambiente não deve exigir Node.js, Python ou daemons locais fora do Obsidian.
5. **Typescript Rigoroso:** Utilize TypeScript Strict, sem type casting cego de objetos brutos.
6. **Sincronização:** Todas as ações de sincronização com o Google Drive devem utilizar "three-way reconciliation" baseado no baseline e nos hashes.
