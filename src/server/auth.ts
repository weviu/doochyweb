import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { User } from "./db";

const BCRYPT_ROUNDS = 10;
const JWT_TTL = "7d";

export interface AuthedRequest extends Request {
  userId?: string;
}

function jwtSecret(): string {
  // Temporary minimal hardening (see project brief §2). Next iteration should
  // use an asymmetric key or rotate this via the environment on deploy.
  return process.env.JWT_SECRET || "insecure-development-secret";
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: JWT_TTL });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing authorization header" });
    return;
  }
  let payload: any;
  try {
    payload = jwt.verify(header.slice(7), jwtSecret());
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }
  if (!payload || typeof payload.userId !== "string") {
    res.status(401).json({ error: "invalid token payload" });
    return;
  }
  req.userId = payload.userId;
  next();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function findUserByUsername(username: string) {
  return User.findOne({ username }).exec();
}