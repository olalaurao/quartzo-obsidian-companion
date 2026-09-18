import * as http from 'http';
import { describe, expect, it } from 'vitest';
import {
  GoogleOAuthDesktop,
  type BrowserOpener,
  type OAuthConfig,
  type TokenResponse,
} from '../../src/integrations/google/auth/loopback';
import {
  GOOGLE_OAUTH_CLIENT_SECRET_ID,
  GOOGLE_REFRESH_TOKEN_SECRET_ID,
} from '../../src/platform/secret-ids';

class MemorySecretStorage {
  private readonly values = new Map<string, string>();

  private assertValidId(key: string): void {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) {
      throw new Error('Secret ID is invalid');
    }
  }

  async get(key: string): Promise<string | null> {
    this.assertValidId(key);
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.assertValidId(key);
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.assertValidId(key);
    this.values.delete(key);
  }
}

class DelayedTokenOAuth extends GoogleOAuthDesktop {
  async exchangeCodeForToken(_code: string): Promise<TokenResponse> {
    await new Promise(resolve => setTimeout(resolve, 75));
    return {
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }
}

function getStatus(target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.get(target, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
  });
}

const config: OAuthConfig = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  redirectUri: '',
  scopes: ['https://www.googleapis.com/auth/drive'],
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

describe('Google OAuth desktop loopback', () => {
  it('uses Obsidian-compatible SecretStorage IDs', () => {
    for (const id of [GOOGLE_REFRESH_TOKEN_SECRET_ID, GOOGLE_OAUTH_CLIENT_SECRET_ID]) {
      expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    }
  });

  it('ignores browser auxiliary requests while the valid callback exchanges its code', async () => {
    let callbackStatus = 0;
    let faviconStatus = 0;

    const opener: BrowserOpener = {
      open: async authUrl => {
        const authorization = new URL(authUrl);
        const redirectUri = authorization.searchParams.get('redirect_uri');
        const state = authorization.searchParams.get('state');
        if (!redirectUri || !state) throw new Error('OAuth URL is missing redirect_uri/state');

        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'test_code');
        callback.searchParams.set('state', state);

        callbackStatus = await getStatus(callback.toString());
        faviconStatus = await getStatus(new URL('/favicon.ico', redirectUri).toString());
      },
    };

    const client = new DelayedTokenOAuth(config, new MemorySecretStorage(), opener);
    const token = await client.startAuthLoopback(true);

    expect(callbackStatus).toBe(200);
    expect(faviconStatus).toBe(404);
    expect(token.access_token).toBe('test_access_token');
  });

  it('still rejects an OAuth callback with the wrong state', async () => {
    const opener: BrowserOpener = {
      open: async authUrl => {
        const authorization = new URL(authUrl);
        const redirectUri = authorization.searchParams.get('redirect_uri');
        if (!redirectUri) throw new Error('OAuth URL is missing redirect_uri');

        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'test_code');
        callback.searchParams.set('state', 'wrong_state');
        await getStatus(callback.toString());
      },
    };

    const client = new GoogleOAuthDesktop(config, new MemorySecretStorage(), opener);
    await expect(client.startAuthLoopback()).rejects.toThrow('State mismatch');
  });
  it('sends the Desktop client credential for authorization-code and refresh-token exchanges', async () => {
    const requestBodies: string[] = [];
    const tokenServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requestBodies.push(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: `access_${requestBodies.length}`,
          expires_in: 3600,
          token_type: 'Bearer',
        }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      tokenServer.once('error', reject);
      tokenServer.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = tokenServer.address();
      if (!address || typeof address === 'string') throw new Error('Token test server did not expose a TCP port');

      const storage = new MemorySecretStorage();
      await storage.set(GOOGLE_REFRESH_TOKEN_SECRET_ID, 'stored_refresh_token');
      const client = new GoogleOAuthDesktop({
        ...config,
        clientSecret: 'desktop_client_credential',
        tokenUrl: `http://127.0.0.1:${address.port}/token`,
      }, storage);

      client.generatePKCE();
      await client.exchangeCodeForToken('authorization_code');
      await client.refreshAccessToken();

      expect(requestBodies).toHaveLength(2);
      const authorizationCodeRequest = new URLSearchParams(requestBodies[0]);
      expect(authorizationCodeRequest.get('client_id')).toBe(config.clientId);
      expect(authorizationCodeRequest.get('client_secret')).toBe('desktop_client_credential');
      expect(authorizationCodeRequest.get('code')).toBe('authorization_code');
      expect(authorizationCodeRequest.get('code_verifier')).toBeTruthy();

      const refreshRequest = new URLSearchParams(requestBodies[1]);
      expect(refreshRequest.get('client_id')).toBe(config.clientId);
      expect(refreshRequest.get('client_secret')).toBe('desktop_client_credential');
      expect(refreshRequest.get('refresh_token')).toBe('stored_refresh_token');
      expect(refreshRequest.get('grant_type')).toBe('refresh_token');
    } finally {
      await new Promise<void>(resolve => tokenServer.close(() => resolve()));
    }
  });

});
