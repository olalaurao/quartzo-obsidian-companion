import * as http from 'http';
import { describe, expect, it } from 'vitest';
import {
  GoogleOAuthDesktop,
  type BrowserOpener,
  type OAuthConfig,
  type TokenResponse,
} from '../../src/integrations/google/auth/loopback';

class MemorySecretStorage {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
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
});
