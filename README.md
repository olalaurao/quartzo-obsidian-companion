# Quartzo Obsidian Companion V1

O Quartzo Companion é um plugin para Obsidian (Desktop apenas) que atua como o segundo cliente oficial do Quartzo, compartilhando o mesmo vault canônico via Google Drive.

## Visão Geral
* **Desktop only**: Windows, macOS, Linux.
* **Google Drive Sync**: Requer pareamento com um vault Quartzo remoto.
* **Offline-first**: Funciona offline com reconciliação 3-way.

## Limitações
* Reminders funcionam no formato "best effort" via notificações de sistema apenas enquanto o Obsidian estiver aberto.
* Rotinas/Systems do tipo `custom_script` e execuções automáticas de background não são suportadas para manter segurança em ambientes distribuídos.
* O objeto `daily_note` é suportado apenas em modo bruto/read-only (sem editor visual estruturado).

## Instalação via BRAT (Private Beta)
Como este repositório é privado:
1. Instale o plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat) no Obsidian.
2. Crie um GitHub fine-grained PAT (Personal Access Token) dedicado com acesso Read-only para `quartzo-obsidian-companion`.
3. Adicione este token nas configurações do BRAT.
4. Adicione o plugin beta informando `olalaurao/quartzo-obsidian-companion`.
5. Habilite o "Quartzo Companion".

## Desenvolvimento e Testes
O projeto possui 100% dos fixtures canônicos upstream (v1.0.0).

```bash
npm ci
npm run dev          # Compilar modo dev com watch
npm run typecheck    # Verificar tipos
npm run lint         # ESLint
npm test             # Todos os testes Unitários (Vitest)
npm run test:contracts # Apenas testes de contrato
npm run test:sync    # Apenas testes de Sincronização
npm run build        # Build final de Produção
```

## Releases
A release é feita criando uma tag matching a versão do `manifest.json`. GitHub Actions compilará `main.js`, `styles.css` e fará release do `manifest.json`.
(Nota: OAuth Desktop Client ID deve estar configurado no ambiente antes da release).
