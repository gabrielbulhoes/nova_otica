import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../../config/env.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string | null;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  storeId: string | null;
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 10);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    storeId: user.storeId,
  };
  const options = { expiresIn: env.JWT_EXPIRES_IN } as unknown as jwt.SignOptions;
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
