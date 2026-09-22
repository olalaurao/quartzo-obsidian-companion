# Google OAuth Setup

**Desktop OAuth client ID must be configured before beta release.**

Para configurar a credencial no Google Cloud Platform:
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione o projeto Quartzo.
3. Vá em "APIs & Services" > "Credentials".
4. Clique em "Create Credentials" > "OAuth client ID".
5. Selecione Application type: **Desktop app**.
6. Nomeie como "Quartzo Companion Desktop".
7. Clique em Create.
8. Copie o Client ID.

Não configure Client Secret para o Companion. O fluxo desktop usa Client ID + loopback `127.0.0.1` + PKCE, e o build não deve enviar nem empacotar segredo de cliente.

Configure a build exportando a variável:
`export QUARTZO_GOOGLE_DESKTOP_CLIENT_ID="seu-client-id"`

Isso será utilizado no momento do build final.
