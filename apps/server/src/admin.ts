import type express from "express";
import { prisma } from "./db";
import type { JwtUser } from "./auth";

export function isAdmin(u: JwtUser | null | undefined) {
  return u?.role === "ADMIN";
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return defaultValue;
  return (row.valueJson as any) as T;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, valueJson: value as any },
    update: { valueJson: value as any }
  });
}

export function requireAdminOr403(res: express.Response, user: JwtUser | null) {
  if (!isAdmin(user)) {
    res.status(403).json({ ok: false, error: "需要管理员权限" });
    return false;
  }
  return true;
}

