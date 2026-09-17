import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

export interface OAuthConfig {
  clientId: string;
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

export interface BrowserOpener {
  open(url: string): Promise<void>;
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
  private secretStorage: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void>; delete: (key: string) => Promise<void> };
  private browserOpener: BrowserOpener;

  constructor(
    config: OAuthConfig,
    secretStorage: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void>; delete: (key: string) => Promise<void> },
    browserOpener?: BrowserOpener
  ) {
    this.config = config;
    this.secretStorage = secretStorage;
    this.browserOpener = browserOpener || {
      open: async (url: string) => {
        const { exec } = require('child_process');
        const platform = process.platform;
        let command: string;
        switch (platform) {
          case 'darwin': command = `open "${url}"`; break;
          case 'win32': command = `start "" "${url}"`; break;
          default: command = `xdg-open "${url}"`; break;
        }
        exec(command);
      }
    };
  }

  generatePKCE(): { verifier: string; challenge: string; state: string } {
    this.codeVerifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(this.codeVerifier).digest('base64url');
    this.state = randomBytes(16).toString('hex');
    return { verifier: this.codeVerifier, challenge, state: this.state };
  }

  getRedirectUri(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  buildAuthUrl(forceConsent?: boolean): string {
    const { challenge, state } = this.generatePKCE();
    const authUrl = new URL(this.config.authUrl);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', this.getRedirectUri());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    if (forceConsent) {
      authUrl.searchParams.set('prompt', 'consent');
    }
    return authUrl.toString();
  }

  async startAuthLoopback(forceConsent?: boolean): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.cleanup();
        fn();
      };

      this.server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        const { code, state, error } = parsedUrl.query;

        const stateBuffer = Buffer.from(this.state);
        const receivedStateBuffer = Buffer.from(state as string || '');

        if (stateBuffer.length !== receivedStateBuffer.length ||
            !timingSafeEqual(stateBuffer, receivedStateBuffer)) {
          res.writeHead(400);
          res.end('State mismatch');
          finish(() => reject(new Error('State mismatch')));
          return;
        }

        if (error) {
          res.writeHead(400);
          res.end(`Auth failed: ${error}`);
          finish(() => reject(new Error(error as string)));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Success</h1><p>Close this tab.</p></body></html>');
          try {
            const tokenResponse = await this.exchangeCodeForToken(code as string);
            this.accessToken = tokenResponse.access_token;
            this.refreshToken = tokenResponse.refresh_token || null;
            this.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
            if (this.refreshToken) {
              await this.secretStorage.set('quartzo_companion/refresh_token', this.refreshToken);
            }
            finish(() => resolve(tokenResponse));
          } catch (err) {
            finish(() => reject(err));
          }
        } else {
          res.writeHead(400);
          res.end('Missing code');
          finish(() => reject(new Error('Missing authorization code')));
        }
      });

      this.timeoutId = setTimeout(() => {
        finish(() => reject(new Error('OAuth timeout: callback never received')));
      }, 10 * 60 * 1000);

      this.server.listen(0, '127.0.0.1', async () => {
        const address = this.server?.address() as { port: number };
        this.port = address.port;
        const authUrl = this.buildAuthUrl(forceConsent);
        try {
          await this.browserOpener.open(authUrl);
        } catch (err) {
          finish(() => reject(new Error(`Failed to open browser: ${err}`)));
        }
      });

      this.server.on('error', (err) => {
        finish(() => reject(err));
      });
    });
  }

  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    if (!this.codeVerifier) throw new Error('Code verifier not set');
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('client_id', this.config.clientId);
    params.append('redirect_uri', this.getRedirectUri());
    params.append('grant_type', 'authorization_code');
    params.append('code_verifier', this.codeVerifier);
    return this.makeTokenRequest(params);
  }

  async refreshAccessToken(): Promise<TokenResponse> {
    const storedRefreshToken = await this.secretStorage.get('quartzo_companion/refresh_token');
    if (!storedRefreshToken) throw new Error('No refresh token available');
    const params = new URLSearchParams();
    params.append('refresh_token', storedRefreshToken);
    params.append('client_id', this.config.clientId);
    params.append('grant_type', 'refresh_token');
    const tokenResponse = await this.makeTokenRequest(params);
    this.accessToken = tokenResponse.access_token;
    this.expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
    if (tokenResponse.refresh_token) {
      this.refreshToken = tokenResponse.refresh_token;
      await this.secretStorage.set('quartzo_companion/refresh_token', this.refreshToken);
    }
    return tokenResponse;
  }

  private async makeTokenRequest(params: URLSearchParams): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      const isHttps = this.config.tokenUrl.startsWith('https://');
      const httpModule = isHttps ? https : http;
      const req = httpModule.request(this.config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Token request failed ${res.statusCode}: ${data}`));
              return;
            }
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse token response: ${error}`));
          }
        });
      });
      req.on('error', (error) => { reject(new Error(`Token request failed: ${error}`)); });
      req.write(params.toString());
      req.end();
    });
  }

  async disconnect(): Promise<void> {
    const tokenToRevoke = this.accessToken || await this.secretStorage.get('quartzo_companion/refresh_token');
    this.cleanup();
    await this.secretStorage.delete('quartzo_companion/refresh_token');
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;

    if (tokenToRevoke) {
      try {
        const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${tokenToRevoke}`;
        await new Promise<void>((resolve) => {
          const req = https.request(revokeUrl, { method: 'POST' }, () => { resolve(); });
          req.on('error', () => { resolve(); });
          req.end();
        });
      } catch { /* best effort revoke */ }
    }
  }

  getAccessToken(): string | null {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    return null;
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null && Date.now() < this.expiresAt;
  }

  abort(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.server) {
      try { this.server.close(); } catch { /* ignore */ }
      this.server = null;
    }
  }
}
