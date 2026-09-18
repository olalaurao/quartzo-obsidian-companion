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

9. **Quota temporária do Drive:** pairing/sync explícitos não devem tratar limite temporário por minuto da API do Google Drive como falha de autenticação. O cliente deve aguardar/repetir com backoff sem fazer mutações inseguras; uma nova tentativa não deve desperdiçar trabalho já comprovado de arquivos remotos inalterados. Se a quota continuar esgotada após o orçamento de retries, a operação inteira deve parar com erro temporário explícito, em vez de repetir a espera arquivo por arquivo.

10. **Progresso do primeiro pairing:** após `Accept & Pair`, a UI deve permanecer explicitamente ocupada até a operação terminar. O usuário precisa ver as fases de revalidação, baseline, adoção/upload local, pull remoto e finalização; ações de confirmação/cancelamento que possam iniciar outra operação ficam desabilitadas durante a mutação. O coordenador é a fonte de verdade do estado transitório do pairing, portanto navegar para outra tela e voltar não pode oferecer um segundo pairing concorrente. Ao concluir ou falhar, a tela de Sync deve ser re-renderizada para não exibir estado antigo.

11. **Falha observável no primeiro pairing:** uma falha após `Accept & Pair` não pode fechar silenciosamente a superfície de pairing nem depender apenas de `Notice` temporário. O motivo completo deve permanecer visível e copiável até ação explícita do usuário, e a tela de Sync deve continuar mostrando o último erro de pairing enquanto o dispositivo permanecer não pareado. A tela de Sync também deve exibir a versão carregada do Companion para diagnóstico de atualização.

12. **Uma única superfície para o primeiro pairing:** diagnóstico de divergências/ambiguidades, confirmação de limpeza segura, progresso da limpeza, rescan, resumo final, `Accept & Pair`, progresso da aplicação e erro final devem acontecer na mesma superfície visual. Não abrir confirmação nativa ou outro modal por baixo/por cima da superfície de pairing. Cada fase substitui o conteúdo da mesma janela; o usuário nunca deve precisar fechar uma tela para alcançar a próxima.

13. **Pós-condição da limpeza de duplicados:** mover um candidato para a lixeira do Drive só conta como sucesso quando a API confirmar `trashed=true`. O inventário de pairing deve ignorar recursos marcados como `trashed` mesmo se uma listagem atrasada ainda os devolver. Se a limpeza não puder confirmar a pós-condição ou o rescan ainda reportar um ID recém-movido como ativo, a mesma superfície deve preservar o erro completo; não voltar silenciosamente para `Pairing blocked`.
