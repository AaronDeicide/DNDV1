import type express from "express";
import { readBearerToken, verifyJwt, type JwtUser } from "../auth";

export function requireHttpAuth(req: express.Request): JwtUser | null {
  const token = readBearerToken(req.headers.authorization);
  if (!token) return null;
  try {
    return verifyJwt(token);
  } catch {
    return null;
  }
}

