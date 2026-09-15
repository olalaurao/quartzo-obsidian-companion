import * as http from 'http';
import { randomBytes, createHash } from 'crypto';

export class GoogleOAuthDesktop {
  private server: http.Server | null = null;
  private state: string = '';
  private codeVerifier: string = '';

  generatePKCE() {
    this.codeVerifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(this.codeVerifier).digest('base64url');
    this.state = randomBytes(16).toString('hex');
    return { challenge, state: this.state };
  }

  async startAuthLoopback(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Extract code and state from req.url
        // Verify state matches
        // Resolve with code
        res.end('Authentication successful! You can close this tab.');
        this.server?.close();
      });
      
      // Bind to 127.0.0.1 on a random port
      this.server.listen(0, '127.0.0.1', () => {
        // open browser with auth URL...
      });
    });
  }
}
