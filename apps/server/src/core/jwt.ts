import { errors, jwtVerify, SignJWT } from 'jose';
import { AppError } from './errors.js';

// DI token for the secret string (the value, not a key object: the IP hash also needs it).
export const JWT_SECRET = 'JWT_SECRET';
export const ACCESS_TOKEN_TTL = '15m';
export const MIN_JWT_SECRET_LENGTH = 32;
const JWT_ALGORITHMS = ['HS256'];

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

// Verifies signature, algorithm (HS256 only, so alg none is rejected) and exp.
// Returns only `sub`. Expired: TOKEN_EXPIRED. Anything else invalid: UNAUTHENTICATED (§3.3).
export async function verifyAccessToken(secret: string, token: string): Promise<{ sub: string }> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: JWT_ALGORITHMS,
    });
    if (typeof payload.sub !== 'string') throw new AppError('UNAUTHENTICATED');
    return { sub: payload.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof errors.JWTExpired) throw new AppError('TOKEN_EXPIRED');
    throw new AppError('UNAUTHENTICATED');
  }
}
