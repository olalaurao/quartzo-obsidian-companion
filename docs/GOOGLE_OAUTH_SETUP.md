# Google OAuth Setup

**Desktop OAuth client ID and client secret must be configured before release.**

Para configurar a credencial no Google Cloud Platform:
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione o projeto Quartzo.
3. Vá em "APIs & Services" > "Credentials".
4. Clique em "Create Credentials" > "OAuth client ID".
5. Selecione Application type: **Desktop app**.
6. Nomeie como "Quartzo Companion Desktop".
7. Clique em Create.
8. Copie o Client ID e o Client Secret gerados para esse mesmo cliente Desktop.

O fluxo desktop usa Client ID + Client Secret + loopback `127.0.0.1` + PKCE. O Client Secret é credential de build/release do cliente Desktop; tokens do usuário continuam somente no `SecretStorage` do Obsidian.

Configure a build exportando as variáveis:
`export QUARTZO_GOOGLE_DESKTOP_CLIENT_ID="seu-client-id"`
`export QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET="seu-client-secret"`

Isso será utilizado no momento do build final.
