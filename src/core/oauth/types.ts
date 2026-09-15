export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

export interface PKCECodePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export interface OAuthState {
  state: string;
  verifier: string;
  createdAt: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface OAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
}

export interface OAuthResult {
  success: boolean;
  session?: OAuthSession;
  error?: string;
  errorDescription?: string;
}
