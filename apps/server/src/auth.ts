import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { config } from "./config";

export type JwtUser = {
  userId: string;
  role: "USER" | "ADMIN";
  name: string;
};

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signJwt(payload: JwtUser) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "30d" });
}

export function verifyJwt(token: string): JwtUser {
  return jwt.verify(token, config.jwtSecret) as JwtUser;
}

export function readBearerToken(authHeader: string | undefined) {
  const raw = String(authHeader ?? "");
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

