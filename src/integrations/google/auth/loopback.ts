import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
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
  private secretStorage: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> };

  constructor(config: OAuthConfig, secretStorage: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> }) {
    this.config = config;
    this.secretStorage = secretStorage;
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
    const { exec } = require('child_process');
    const platform = process.platform;

    let command: string;
    switch (platform) {
      case 'darwin':
        command = `open "${authUrl}"`;
        break;
      case 'win32':
        command = `start "" "${authUrl}"`;
        break;
      default:
        command = `xdg-open "${authUrl}"`;
        break;
    }

    exec(command, (error: Error | null) => {
      if (error) {
        console.error('Failed to open browser:', error);
      }
    });
  }

  async startAuthLoopback(): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        const { code, state, error, error_description } = parsedUrl.query;

        this.timeoutId = setTimeout(() => {
          this.cleanup();
          reject(new Error('OAuth timeout'));
        }, 10 * 60 * 1000);

        const stateBuffer = Buffer.from(this.state);
        const receivedStateBuffer = Buffer.from(state as string || '');

        if (stateBuffer.length !== receivedStateBuffer.length || 
            !timingSafeEqual(stateBuffer, receivedStateBuffer)) {
          res.writeHead(400);
          res.end('State mismatch - possible CSRF attack');
          this.cleanup();
          reject(new Error('State mismatch'));
          return;
        }

        if (error) {
          res.writeHead(400);
          res.end(`Authentication failed: ${error}`);
          this.cleanup();
          reject(new Error(error as string));
          return;
        }

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

          try {
            const tokenResponse = await this.exchangeCodeForToken(code as string);
            this.accessToken = tokenResponse.access_token;
            this.refreshToken = tokenResponse.refresh_token || null;
            this.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
            
            if (this.refreshToken) {
              await this.secretStorage.set('oauth_refresh_token', this.refreshToken);
            }
            
            this.cleanup();
            resolve(tokenResponse);
          } catch (err) {
            this.cleanup();
            reject(err);
          }
        } else {
          res.writeHead(400);
          res.end('Missing authorization code');
          this.cleanup();
          reject(new Error('Missing authorization code'));
        }
      });
      
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address() as { port: number };
        this.port = address.port;
        
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
    if (!this.codeVerifier) {
      throw new Error('Code verifier not set');
    }

    const params = new URLSearchParams();
    params.append('code', code);
    params.append('client_id', this.config.clientId);
    params.append('redirect_uri', this.getRedirectUri());
    params.append('grant_type', 'authorization_code');
    params.append('code_verifier', this.codeVerifier);

    return this.makeTokenRequest(params);
  }

  async refreshAccessToken(): Promise<TokenResponse> {
    const storedRefreshToken = await this.secretStorage.get('oauth_refresh_token');
    if (!storedRefreshToken) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams();
    params.append('refresh_token', storedRefreshToken);
    params.append('client_id', this.config.clientId);
    params.append('grant_type', 'refresh_token');

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    const tokenResponse = await this.makeTokenRequest(params);

    this.accessToken = tokenResponse.access_token;
    this.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);

    if (tokenResponse.refresh_token) {
      this.refreshToken = tokenResponse.refresh_token;
      await this.secretStorage.set('oauth_refresh_token', this.refreshToken);
    }

    return tokenResponse;
  }

  private async makeTokenRequest(params: URLSearchParams): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      const isHttps = this.config.tokenUrl.startsWith('https://');
      const httpModule = isHttps ? https : http;

      const req = httpModule.request(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Token request failed with status ${res.statusCode}: ${data}`));
              return;
            }

            const tokenResponse = JSON.parse(data);
            resolve(tokenResponse);
          } catch (error) {
            reject(new Error(`Failed to parse token response: ${error}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Token request failed: ${error}`));
      });

      req.write(params.toString());
      req.end();
    });
  }

  async revokeToken(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    const revokeUrl = 'https://oauth2.googleapis.com/revoke';
    const params = new URLSearchParams();
    params.append('token', this.accessToken);

    return new Promise((resolve, reject) => {
      const req = https.request(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Revoke failed with status ${res.statusCode}`));
        }
      });

      req.on('error', (error) => {
        reject(new Error(`Revoke request failed: ${error}`));
      });

      req.write(params.toString());
      req.end();
    });
  }

  async disconnect(): Promise<void> {
    await this.revokeToken();
    await this.secretStorage.set('oauth_refresh_token', '');
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
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
