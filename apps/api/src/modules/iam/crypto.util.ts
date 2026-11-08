import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export interface TokenClaims {
  userId: string;
  tenantId: string;
  [key: string]: unknown;
}

export class CryptoUtil {
  private static readonly ISSUER = 'restaurant-cloud';
  private static readonly AUDIENCE = 'restaurant-cloud-api';

  private static getSecret(): string {
    const secret = process.env.JWT_SECRET || 'restaurant_cloud_secure_dev_jwt_key_2026_min_32_chars';
    if (process.env.NODE_ENV === 'production' && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    return secret;
  }

  private static getPreviousSecret(): string | undefined {
    return process.env.JWT_PREVIOUS_SECRET;
  }

  /**
   * Asynchronous, non-blocking password hashing using scrypt.
   * Format: salt:derivedKey (hex encoded)
   */
  static async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  /**
   * Asynchronous, non-blocking timing-safe password verification.
   */
  static async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const originalBuffer = Buffer.from(originalHash, 'hex');

    if (derivedKey.length !== originalBuffer.length) return false;
    return timingSafeEqual(derivedKey, originalBuffer);
  }

  /**
   * Signs a JWT with standard claims (iss, aud, exp) and HS256 algorithm.
   */
  static signToken(payload: TokenClaims, expiresInSeconds = 86400): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInSeconds;

    const claims = Buffer.from(
      JSON.stringify({
        ...payload,
        iss: this.ISSUER,
        aud: this.AUDIENCE,
        iat: now,
        exp,
      })
    ).toString('base64url');

    const signature = createHmac('sha256', this.getSecret())
      .update(`${header}.${claims}`)
      .digest('base64url');

    return `${header}.${claims}.${signature}`;
  }

  /**
   * Validates JWT:
   * 1. Algorithm allowlisting (strictly 'HS256').
   * 2. Timing-safe signature check with rotation fallback.
   * 3. Claims validation (iss, aud, exp).
   */
  static verifyToken<T extends TokenClaims = TokenClaims>(token: string): T | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [headerB64, claimsB64, signatureB64] = parts;
      if (!headerB64 || !claimsB64 || !signatureB64) return null;

      // 1. Algorithm Allowlisting
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        return null; // Reject unexpected or 'none' algorithms
      }

      // 2. Signature Validation (with key rotation support)
      const input = `${headerB64}.${claimsB64}`;
      const sigBuffer = Buffer.from(signatureB64, 'base64url');

      let isValidSig = false;
      const expectedPrimary = createHmac('sha256', this.getSecret()).update(input).digest();
      if (sigBuffer.length === expectedPrimary.length && timingSafeEqual(sigBuffer, expectedPrimary)) {
        isValidSig = true;
      } else {
        const prevSecret = this.getPreviousSecret();
        if (prevSecret) {
          const expectedPrev = createHmac('sha256', prevSecret).update(input).digest();
          if (sigBuffer.length === expectedPrev.length && timingSafeEqual(sigBuffer, expectedPrev)) {
            isValidSig = true;
          }
        }
      }

      if (!isValidSig) return null;

      // 3. Claims Validation
      const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);

      if (claims.exp && claims.exp < now) {
        return null; // Expired
      }
      if (claims.iss && claims.iss !== this.ISSUER) {
        return null; // Invalid Issuer
      }
      if (claims.aud && claims.aud !== this.AUDIENCE) {
        return null; // Invalid Audience
      }

      return claims as T;
    } catch {
      return null;
    }
  }
}
