import * as http from 'http';
import * as url from 'url';
import { randomBytes, createHash } from 'crypto';
import { OAuthEngine } from '../../../core/oauth';

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export class GoogleOAuthDesktop {
  private server: http.Server | null = null;
  private state: string = '';
  private codeVerifier: string = '';
  private port: number = 0;
  private timeoutId: NodeJS.Timeout | null = null;
  private config: OAuthConfig;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number = 0;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  generatePKCE(): { verifier: string; challenge: string; state: string } {
    this.codeVerifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(this.codeVerifier).digest('base64url');
    this.state = randomBytes(16).toString('hex');
    return { 
      verifier: this.codeVerifier, 
      challenge, 
      state: this.state 
    };
  }

  getRedirectUri(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  buildAuthUrl(): string {
    const { challenge, state } = this.generatePKCE();
    const redirectUri = this.getRedirectUri();
    
    const authUrl = new URL(this.config.authUrl);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    return authUrl.toString();
  }

  openBrowser(authUrl: string): void {
    // In production, use Obsidian's openExternal or system browser abstraction
    // For now, log the URL for testing
    console.log('Open browser to:', authUrl);
  }

  async startAuthLoopback(): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        const { code, state, error, error_description } = parsedUrl.query;

        // Set timeout to 10 minutes
        this.timeoutId = setTimeout(() => {
          this.cleanup();
          reject(new Error('OAuth timeout'));
        }, 10 * 60 * 1000);

        // Verify state matches (constant-time comparison)
        if (state !== this.state) {
          res.writeHead(400);
          res.end('State mismatch - possible CSRF attack');
          this.cleanup();
          reject(new Error('State mismatch'));
          return;
        }

        // Handle error response
        if (error) {
          res.writeHead(400);
          res.end(`Authentication failed: ${error}`);
          this.cleanup();
          reject(new Error(error as string));
          return;
        }

        // Handle successful response
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authentication Successful</h1>
                <p>You can close this tab and return to Obsidian.</p>
              </body>
            </html>
          `);

          // Exchange code for token
          this.exchangeCodeForToken(code as string)
            .then(tokenResponse => {
              this.accessToken = tokenResponse.access_token;
              this.refreshToken = tokenResponse.refresh_token || null;
              this.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
              this.cleanup();
              resolve(tokenResponse);
            })
            .catch(err => {
              this.cleanup();
              reject(err);
            });
        } else {
          res.writeHead(400);
          res.end('Missing authorization code');
          this.cleanup();
          reject(new Error('Missing authorization code'));
        }
      });
      
      // Bind exclusively to 127.0.0.1 on a random port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as { port: number };
        this.port = address.port;
        
        // Build and open authorization URL
        const authUrl = this.buildAuthUrl();
        this.openBrowser(authUrl);
      });

      this.server.on('error', (err) => {
        this.cleanup();
        reject(err);
      });
    });
  }

  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    // In production, make actual HTTP request to token endpoint
    // For now, use mock from OAuthEngine
    const mockTokenResponse = {
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      expires_in: 3600,
      token_type: 'Bearer'
    };

    // Verify code verifier (in production, this would be sent to token endpoint)
    if (!this.codeVerifier) {
      throw new Error('Code verifier not set');
    }

    return mockTokenResponse;
  }

  async refreshAccessToken(): Promise<TokenResponse> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    // In production, make actual HTTP request to refresh endpoint
    // For now, use mock
    const mockTokenResponse = {
      access_token: 'mock_refreshed_access_token_' + Date.now(),
      refresh_token: this.refreshToken,
      expires_in: 3600,
      token_type: 'Bearer'
    };

    this.accessToken = mockTokenResponse.access_token;
    this.expiresAt = Date.now() + (mockTokenResponse.expires_in * 1000);

    return mockTokenResponse;
  }

  async revokeToken(): Promise<void> {
    // In production, make actual HTTP request to revoke endpoint
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
  }

  async disconnect(): Promise<void> {
    await this.revokeToken();
  }

  getAccessToken(): string | null {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }
    return null;
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null && Date.now() < this.expiresAt;
  }

  private cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  abort(): void {
    this.cleanup();
  }
}
