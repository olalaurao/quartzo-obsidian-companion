import { describe, it, expect } from 'vitest';
import { OAuthEngine } from '../../src/core/oauth';

describe('OAuth Architecture with Mocks', () => {
  const mockConfig = {
    clientId: 'test-client-id',
    redirectUri: 'http://127.0.0.1:8080/callback',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token'
  };

  it('should generate PKCE code pair', () => {
    const pkce = OAuthEngine.generatePKCECodePair();
    
    expect(pkce).toHaveProperty('verifier');
    expect(pkce).toHaveProperty('challenge');
    expect(pkce).toHaveProperty('method');
    expect(pkce.method).toBe('S256');
    expect(pkce.verifier).toBeTruthy();
    expect(pkce.challenge).toBeTruthy();
  });

  it('should generate unique state', () => {
    const state1 = OAuthEngine.generateState();
    const state2 = OAuthEngine.generateState();
    
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);
  });

  it('should create OAuth flow with auth URL', () => {
    const flow = OAuthEngine.createOAuthFlow(mockConfig);
    
    expect(flow).toHaveProperty('state');
    expect(flow).toHaveProperty('authUrl');
    expect(flow).toHaveProperty('verifier');
    expect(flow.authUrl).toContain(mockConfig.authUrl);
    expect(flow.authUrl).toContain('client_id=' + mockConfig.clientId);
    expect(flow.authUrl).toContain('response_type=code');
    expect(flow.authUrl).toContain('code_challenge_method=S256');
  });

  it('should handle successful callback with mock token', () => {
    const flow = OAuthEngine.createOAuthFlow(mockConfig);
    const mockTokenResponse = {
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_in: 3600,
      token_type: 'Bearer'
    };
    
    const result = OAuthEngine.handleCallback('test_code', flow.state, mockConfig, mockTokenResponse);
    
    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session?.accessToken).toBe('test_access_token');
    expect(result.session?.refreshToken).toBe('test_refresh_token');
  });

  it('should handle state mismatch', () => {
    const result = OAuthEngine.handleCallback('test_code', 'invalid_state', mockConfig);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('state_mismatch');
  });

  it('should handle denied consent', () => {
    const result = OAuthEngine.handleDeniedConsent('access_denied', 'User denied access');
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('access_denied');
    expect(result.errorDescription).toBe('User denied access');
  });

  it('should refresh access token', () => {
    const mockTokenResponse = {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
      token_type: 'Bearer'
    };
    
    const result = OAuthEngine.refreshAccessToken('old_refresh_token', mockConfig, mockTokenResponse);
    
    expect(result.success).toBe(true);
    expect(result.session?.accessToken).toBe('new_access_token');
  });

  it('should revoke token', () => {
    const result = OAuthEngine.revokeToken('test_token', mockConfig);
    expect(result).toBe(true);
  });

  it('should disconnect session', () => {
    const session = {
      accessToken: 'test_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scopes: mockConfig.scopes
    };
    
    const result = OAuthEngine.disconnect(session, mockConfig);
    expect(result).toBe(true);
  });

  it('should cleanup expired states', () => {
    OAuthEngine.createOAuthFlow(mockConfig);
    OAuthEngine.cleanupExpiredStates();
    // Should not throw
    expect(true).toBe(true);
  });

  it('should cleanup all states', () => {
    OAuthEngine.createOAuthFlow(mockConfig);
    OAuthEngine.cleanupAllStates();
    // Should not throw
    expect(true).toBe(true);
  });
});
