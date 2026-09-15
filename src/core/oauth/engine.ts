import { OAuthConfig, PKCECodePair, OAuthState, TokenResponse, OAuthSession, OAuthResult } from './types';
import { createHash, randomBytes } from 'crypto';

export class OAuthEngine {
  private static activeStates = new Map<string, OAuthState>();
  private static stateTimeout = 10 * 60 * 1000;

  static generatePKCECodePair(): PKCECodePair {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge, method: 'S256' };
  }

  static generateState(): string {
    return randomBytes(16).toString('hex');
  }

  static createOAuthFlow(config: OAuthConfig): { state: string; authUrl: string; verifier: string } {
    const pkce = this.generatePKCECodePair();
    const state = this.generateState();
    const oauthState: OAuthState = { state, verifier: pkce.verifier, createdAt: Date.now() };
    this.activeStates.set(state, oauthState);

    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return { state, authUrl: authUrl.toString(), verifier: pkce.verifier };
  }

  static handleCallback(code: string, state: string, config: OAuthConfig, mockTokenResponse?: TokenResponse): OAuthResult {
    const oauthState = this.activeStates.get(state);
    if (!oauthState) {
      return { success: false, error: 'state_mismatch', errorDescription: 'Invalid or expired state' };
    }
    if (Date.now() - oauthState.createdAt > this.stateTimeout) {
      this.activeStates.delete(state);
      return { success: false, error: 'timeout', errorDescription: 'State expired' };
    }
    this.activeStates.delete(state);

    const tokenResponse = mockTokenResponse || this.mockTokenExchange(code, oauthState.verifier, config);
    if (!tokenResponse) {
      return { success: false, error: 'token_exchange_failed', errorDescription: 'Failed to exchange code for token' };
    }

    const session: OAuthSession = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
      scopes: config.scopes
    };
    return { success: true, session };
  }

  static handleDeniedConsent(error: string, errorDescription: string): OAuthResult {
    return { success: false, error: error || 'access_denied', errorDescription: errorDescription || 'User denied consent' };
  }

  static refreshAccessToken(refreshToken: string, config: OAuthConfig, mockTokenResponse?: TokenResponse): OAuthResult {
    const tokenResponse = mockTokenResponse || this.mockTokenRefresh(refreshToken, config);
    if (!tokenResponse) {
      return { success: false, error: 'refresh_failed', errorDescription: 'Failed to refresh token' };
    }
    const session: OAuthSession = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || refreshToken,
      expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
      scopes: config.scopes
    };
    return { success: true, session };
  }

  static revokeToken(_token: string, _config: OAuthConfig): boolean { return true; }

  static disconnect(session: OAuthSession, config: OAuthConfig): boolean {
    this.revokeToken(session.accessToken, config);
    if (session.refreshToken) this.revokeToken(session.refreshToken, config);
    return true;
  }

  static cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, oauthState] of this.activeStates.entries()) {
      if (now - oauthState.createdAt > this.stateTimeout) {
        this.activeStates.delete(state);
      }
    }
  }

  static cleanupAllStates(): void { this.activeStates.clear(); }

  private static mockTokenExchange(_code: string, _verifier: string, _config: OAuthConfig): TokenResponse | null {
    return {
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      expires_in: 3600,
      token_type: 'Bearer'
    };
  }

  private static mockTokenRefresh(refreshToken: string, _config: OAuthConfig): TokenResponse | null {
    return {
      access_token: 'mock_refreshed_access_token_' + Date.now(),
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'Bearer'
    };
  }
}
