import { OAuthConfig, PKCECodePair, OAuthState, TokenResponse, OAuthSession, OAuthResult } from './types';

export class OAuthEngine {
  private static activeStates = new Map<string, OAuthState>();
  private static stateTimeout = 10 * 60 * 1000; // 10 minutes

  static generatePKCECodePair(): PKCECodePair {
    // Generate random verifier
    const verifier = this.generateRandomString(128);
    // Generate challenge using SHA-256
    const challenge = this.sha256(verifier);
    
    return {
      verifier,
      challenge,
      method: 'S256'
    };
  }

  static generateState(): string {
    return this.generateRandomString(32);
  }

  static createOAuthFlow(config: OAuthConfig): { state: string; authUrl: string; verifier: string } {
    const pkce = this.generatePKCECodePair();
    const state = this.generateState();
    
    // Store state with verifier
    const oauthState: OAuthState = {
      state,
      verifier: pkce.verifier,
      createdAt: Date.now()
    };
    
    this.activeStates.set(state, oauthState);
    
    // Build auth URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    return {
      state,
      authUrl: authUrl.toString(),
      verifier: pkce.verifier
    };
  }

  static handleCallback(
    code: string,
    state: string,
    config: OAuthConfig,
    mockTokenResponse?: TokenResponse
  ): OAuthResult {
    // Validate state
    const oauthState = this.activeStates.get(state);
    if (!oauthState) {
      return { success: false, error: 'state_mismatch', errorDescription: 'Invalid or expired state' };
    }

    // Check state timeout
    if (Date.now() - oauthState.createdAt > this.stateTimeout) {
      this.activeStates.delete(state);
      return { success: false, error: 'timeout', errorDescription: 'State expired' };
    }

    // Clean up state
    this.activeStates.delete(state);

    // Exchange code for token (mock or real)
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
    return {
      success: false,
      error: error || 'access_denied',
      errorDescription: errorDescription || 'User denied consent'
    };
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

  static revokeToken(token: string, config: OAuthConfig): boolean {
    // Mock revoke - always returns true
    return true;
  }

  static disconnect(session: OAuthSession, config: OAuthConfig): boolean {
    // Revoke token and clean up
    this.revokeToken(session.accessToken, config);
    if (session.refreshToken) {
      this.revokeToken(session.refreshToken, config);
    }
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

  static cleanupAllStates(): void {
    this.activeStates.clear();
  }

  private static generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    
    return result;
  }

  private static sha256(input: string): string {
    // Simple mock SHA-256 for testing
    // In production, use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  private static mockTokenExchange(code: string, verifier: string, config: OAuthConfig): TokenResponse | null {
    // Mock token exchange for testing
    return {
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      expires_in: 3600,
      token_type: 'Bearer'
    };
  }

  private static mockTokenRefresh(refreshToken: string, config: OAuthConfig): TokenResponse | null {
    // Mock token refresh for testing
    return {
      access_token: 'mock_refreshed_access_token_' + Date.now(),
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'Bearer'
    };
  }
}
