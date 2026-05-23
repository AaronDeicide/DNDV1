import type express from "express";
import { config } from "../config";

export function requireBotOr403(req: express.Request, res: express.Response) {
  const token = String(req.headers["x-bot-token"] ?? "").trim();
  if (!config.botToken) {
    res.status(503).json({ ok: false, error: "服务端未配置 BOT_TOKEN" });
    return null;
  }
  if (!token || token !== config.botToken) {
    res.status(403).json({ ok: false, error: "BOT_TOKEN 无效" });
    return null;
  }
  return { ok: true as const };
}

