import { SignJWT } from 'jose';

// DI token for the secret string (the value, not a key object: the IP hash also needs it).
export const JWT_SECRET = 'JWT_SECRET';
export const ACCESS_TOKEN_TTL = '15m';
export const MIN_JWT_SECRET_LENGTH = 32;

// No fallback value: a missing or short secret stops the app at startup.
export function readJwtSecret(env: NodeJS.ProcessEnv): string {
  const raw = env.JWT_SECRET;
  if (!raw) throw new Error('JWT_SECRET is not set');
  if (raw.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  return raw;
}

export function signAccessToken(secret: string, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(new TextEncoder().encode(secret));
}
