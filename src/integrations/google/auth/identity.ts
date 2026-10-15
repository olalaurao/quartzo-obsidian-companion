import * as https from 'node:https';

export interface GoogleAccountIdentity { id: string; email: string }

export function readGoogleAccountIdentity(accessToken: string): Promise<GoogleAccountIdentity> {
  return new Promise((resolve, reject) => {
    const req = https.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30_000,
    }, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 64_000) req.destroy(new Error('Google identity response exceeds limit'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`Google identity request failed (${res.statusCode})`);
          const value: unknown = JSON.parse(body);
          if (!value || typeof value !== 'object' || !('sub' in value) || !('email' in value) ||
              typeof value.sub !== 'string' || typeof value.email !== 'string') throw new Error('Invalid Google identity');
          resolve({ id: value.sub, email: value.email });
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Google identity request timed out')));
    req.on('error', reject);
  });
}
