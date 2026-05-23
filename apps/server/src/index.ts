import cors from "cors";
import express from "express";
import http from "http";
import { nanoid } from "nanoid";
import { Server } from "socket.io";
import { Prisma } from "@prisma/client";

import type { ClientToServerEvents, ServerToClientEvents, ChatMessage, RoomInfo, UserPublic } from "@dnd/shared";
import { EVENTS } from "@dnd/shared";

import { prisma } from "./db";
import { config } from "./config";
import { hashPassword, signJwt, verifyJwt, verifyPassword } from "./auth";
import { getDmProvider } from "./dm";
import { requireHttpAuth } from "./api/auth-http";
import { requireBotOr403 } from "./api/bot-auth";
import {
  zBindCampaignModule,
  zBotPostMessage,
  zCreateModule,
  zCreateModuleVersion,
  zCreateSave,
  zDiceRoll,
  zLoadSave,
  zUpsertOnebotBinding
} from "./api/schemas";
import { rollDice } from "./dice";
import { getSetting, requireAdminOr403, setSetting } from "./admin";
import { resolveAssetUrl } from "./assets";

// ====== HTTP API ======
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * 开发登录：只要给一个 name 就返回 JWT token（并在数据库创建用户）。
 */
app.post("/api/auth/dev-login", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "name 不能为空" });

  const user = await prisma.user.create({
    data: { name }
  });

  const token = signJwt({ userId: user.id, role: user.role, name: user.name });
  res.json({ ok: true, token, user: { id: user.id, name: user.name } });
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!name || !email || password.length < 6) return res.status(400).json({ ok: false, error: "参数不合法" });

  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });
    const token = signJwt({ userId: user.id, role: user.role, name: user.name });
    res.json({ ok: true, token, user: { id: user.id, name: user.name } });
  } catch {
    res.status(400).json({ ok: false, error: "注册失败（邮箱可能已存在）" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) return res.status(400).json({ ok: false, error: "参数不合法" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) return res.status(401).json({ ok: false, error: "账号或密码错误" });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "账号或密码错误" });

  const token = signJwt({ userId: user.id, role: user.role, name: user.name });
  res.json({ ok: true, token, user: { id: user.id, name: user.name } });
});

app.post("/api/rooms", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const name = String(req.body?.name ?? "新房间").trim() || "新房间";
  const inviteCode = nanoid(8);

  const room = await prisma.room.create({
    data: {
      name,
      inviteCode,
      createdById: jwtUser.userId,
      members: {
        create: {
          userId: jwtUser.userId,
          role: "GM"
        }
      },
      campaign: {
        create: { stateJson: {} }
      }
    }
  });

  res.json({ ok: true, room: { id: room.id, name: room.name, inviteCode: room.inviteCode } });
});

app.post("/api/rooms/join", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const inviteCode = String(req.body?.inviteCode ?? "").trim();
  if (!inviteCode) return res.status(400).json({ ok: false, error: "inviteCode 不能为空" });

  const room = await prisma.room.findUnique({ where: { inviteCode } });
  if (!room) return res.status(404).json({ ok: false, error: "邀请码无效" });

  await prisma.roomMember.upsert({
    where: { userId_roomId: { userId: jwtUser.userId, roomId: room.id } },
    create: { userId: jwtUser.userId, roomId: room.id, role: "PLAYER" },
    update: {}
  });

  res.json({ ok: true, room: { id: room.id, name: room.name, inviteCode: room.inviteCode } });
});

app.get("/api/rooms/:roomId/messages", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  if (!roomId) return res.status(400).json({ ok: false, error: "roomId 不能为空" });

  const member = await prisma.roomMember.findUnique({
    where: { userId_roomId: { userId: jwtUser.userId, roomId } }
  });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  const rows = await prisma.message.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  const messages: ChatMessage[] = rows
    .reverse()
    .map((m) => {
      const kind = m.kind as ChatMessage["kind"];
      const user =
        kind === "DM"
          ? { id: "dm", name: "DM" }
          : kind === "SYSTEM"
            ? { id: "system", name: "系统" }
            : { id: m.userId ?? "unknown", name: m.authorName };

      return {
        id: m.id,
        roomId: m.roomId,
        kind,
        user,
        text: m.text,
        createdAt: m.createdAt.getTime()
      };
    });

  res.json({ ok: true, messages });
});

// ====== Modules（剧本导入/版本化）=====
app.post("/api/modules", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const parsed = zCreateModule.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const module = await prisma.module.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      ownerId: jwtUser.userId
    }
  });

  res.json({ ok: true, module });
});

app.get("/api/modules", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const modules = await prisma.module.findMany({
    where: { ownerId: jwtUser.userId },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 }
    }
  });
  res.json({ ok: true, modules });
});

app.post("/api/modules/:moduleId/versions", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const moduleId = String(req.params.moduleId ?? "").trim();
  if (!moduleId) return res.status(400).json({ ok: false, error: "moduleId 不能为空" });

  const parsed = zCreateModuleVersion.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const mod = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!mod || mod.ownerId !== jwtUser.userId) return res.status(404).json({ ok: false, error: "剧本不存在" });

  const last = await prisma.moduleVersion.findFirst({
    where: { moduleId },
    orderBy: { version: "desc" }
  });
  const nextVersion = (last?.version ?? 0) + 1;

  const mv = await prisma.moduleVersion.create({
    data: {
      moduleId,
      version: nextVersion,
      markdown: parsed.data.markdown
    }
  });

  res.json({ ok: true, moduleVersion: mv });
});

app.get("/api/modules/:moduleId/versions", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const moduleId = String(req.params.moduleId ?? "").trim();
  if (!moduleId) return res.status(400).json({ ok: false, error: "moduleId 不能为空" });

  const mod = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!mod || mod.ownerId !== jwtUser.userId) return res.status(404).json({ ok: false, error: "剧本不存在" });

  const versions = await prisma.moduleVersion.findMany({
    where: { moduleId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, createdAt: true }
  });

  res.json({ ok: true, versions });
});

app.get("/api/module-versions/:moduleVersionId", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const moduleVersionId = String(req.params.moduleVersionId ?? "").trim();
  const mv = await prisma.moduleVersion.findUnique({
    where: { id: moduleVersionId },
    include: { module: true }
  });
  if (!mv || mv.module.ownerId !== jwtUser.userId) return res.status(404).json({ ok: false, error: "版本不存在" });
  res.json({ ok: true, moduleVersion: mv });
});

// ====== Campaign（绑定剧本版本 + 存档/读档）=====
app.get("/api/rooms/:roomId/campaign", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  const campaign = await prisma.campaign.findUnique({
    where: { roomId },
    include: { moduleVersion: { include: { module: true } } }
  });
  if (!campaign) return res.status(404).json({ ok: false, error: "Campaign 不存在" });
  res.json({ ok: true, campaign });
});

app.post("/api/rooms/:roomId/campaign/bind-module", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  // 只允许 GM 绑定剧本
  if (member.role !== "GM") return res.status(403).json({ ok: false, error: "只有房主/GM 可以绑定剧本" });

  const parsed = zBindCampaignModule.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const mv = await prisma.moduleVersion.findUnique({ where: { id: parsed.data.moduleVersionId }, include: { module: true } });
  if (!mv || mv.module.ownerId !== jwtUser.userId) return res.status(404).json({ ok: false, error: "剧本版本不存在" });

  const campaign = await prisma.campaign.update({
    where: { roomId },
    data: {
      moduleVersionId: mv.id,
      // 绑定新剧本时，先保守地把状态重置为空对象（后续可以做“是否保留状态”的开关）
      stateJson: {}
    }
  });

  res.json({ ok: true, campaign });
});

app.post("/api/rooms/:roomId/campaign/save", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  const parsed = zCreateSave.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const campaign = await prisma.campaign.findUnique({ where: { roomId } });
  if (!campaign) return res.status(404).json({ ok: false, error: "Campaign 不存在" });

  const save = await prisma.save.create({
    data: {
      campaignId: campaign.id,
      name: parsed.data.name,
      snapshotJson: (campaign.stateJson ?? {}) as Prisma.InputJsonValue
    }
  });

  res.json({ ok: true, save });
});

app.get("/api/rooms/:roomId/campaign/saves", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  const campaign = await prisma.campaign.findUnique({ where: { roomId } });
  if (!campaign) return res.status(404).json({ ok: false, error: "Campaign 不存在" });

  const saves = await prisma.save.findMany({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true }
  });

  res.json({ ok: true, saves });
});

app.post("/api/rooms/:roomId/campaign/load", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });
  if (member.role !== "GM") return res.status(403).json({ ok: false, error: "只有房主/GM 可以读档" });

  const parsed = zLoadSave.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const campaign = await prisma.campaign.findUnique({ where: { roomId } });
  if (!campaign) return res.status(404).json({ ok: false, error: "Campaign 不存在" });

  const save = await prisma.save.findUnique({ where: { id: parsed.data.saveId } });
  if (!save || save.campaignId !== campaign.id) return res.status(404).json({ ok: false, error: "存档不存在" });

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { stateJson: (save.snapshotJson ?? {}) as Prisma.InputJsonValue }
  });

  res.json({ ok: true, campaign: updated });
});

// ====== Socket.IO ======
const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  // 1) hello: JWT 认证
  socket.on(EVENTS.CLIENT_HELLO, async (payload, ack) => {
    try {
      const jwtUser = verifyJwt(String(payload?.token ?? ""));
      const user = await prisma.user.findUnique({ where: { id: jwtUser.userId } });
      if (!user) {
        ack?.({ ok: false, error: "用户不存在，请重新登录" });
        return;
      }

      socket.data.userId = user.id;
      socket.data.userName = user.name;
      socket.emit(EVENTS.SERVER_WELCOME, { user: { id: user.id, name: user.name } });
      ack?.({ ok: true, user: { id: user.id, name: user.name } });
    } catch {
      ack?.({ ok: false, error: "token 无效，请重新登录" });
    }
  });

  // 2) join room
  socket.on(EVENTS.ROOM_JOIN, async (payload, ack) => {
    const userId = String(socket.data.userId ?? "");
    const userName = String(socket.data.userName ?? "");
    if (!userId) {
      ack?.({ ok: false, error: "未认证：请先发送 client.hello" });
      return;
    }

    const roomId = String(payload?.roomId ?? "").trim();
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      ack?.({ ok: false, error: "房间不存在" });
      return;
    }

    // 如果还没加入，自动加入为 PLAYER（也方便 QQ adapter 直接 join）
    await prisma.roomMember.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { userId, roomId, role: "PLAYER" },
      update: {}
    });

    socket.join(roomId);
    const roomInfo: RoomInfo = { id: room.id, name: room.name, inviteCode: room.inviteCode };
    socket.emit(EVENTS.ROOM_JOINED, { room: roomInfo });
    ack?.({ ok: true, room: roomInfo });

    // 广播系统消息（先用普通聊天体裁）
    const dbMsg = await prisma.message.create({
      data: {
        roomId,
        kind: "SYSTEM",
        text: `玩家 ${userName} 加入了房间`,
        authorName: "系统"
      }
    });

    const message: ChatMessage = {
      id: dbMsg.id,
      roomId: dbMsg.roomId,
      kind: "SYSTEM",
      user: { id: "system", name: "系统" },
      text: dbMsg.text,
      createdAt: dbMsg.createdAt.getTime()
    };
    io.to(roomId).emit(EVENTS.ROOM_CHAT_MESSAGE, { message });
  });

  // 3) chat
  socket.on(EVENTS.ROOM_CHAT_SEND, async (payload, ack) => {
    const userId = String(socket.data.userId ?? "");
    const userName = String(socket.data.userName ?? "");
    if (!userId) {
      ack?.({ ok: false, error: "未认证：请先发送 client.hello" });
      return;
    }

    const roomId = String(payload?.roomId ?? "").trim();
    const text = String(payload?.text ?? "").trim();
    if (!roomId || !text) {
      ack?.({ ok: false, error: "roomId/text 不能为空" });
      return;
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      ack?.({ ok: false, error: "房间不存在" });
      return;
    }

    // 要求已加入（或自动加入）
    await prisma.roomMember.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { userId, roomId, role: "PLAYER" },
      update: {}
    });

    const dbMsg = await prisma.message.create({
      data: {
        roomId,
        userId,
        kind: "CHAT",
        text,
        authorName: userName
      }
    });

    const message: ChatMessage = {
      id: dbMsg.id,
      roomId: dbMsg.roomId,
      kind: "CHAT",
      user: { id: userId, name: userName },
      text: dbMsg.text,
      createdAt: dbMsg.createdAt.getTime()
    };

    io.to(roomId).emit(EVENTS.ROOM_CHAT_MESSAGE, { message });
    ack?.({ ok: true });
  });

  // 4) DM request (DeepSeek)
  socket.on(EVENTS.ROOM_DM_REQUEST, async (payload, ack) => {
    const userId = String(socket.data.userId ?? "");
    const userName = String(socket.data.userName ?? "");
    if (!userId) {
      ack?.({ ok: false, error: "未认证：请先发送 client.hello" });
      return;
    }

    const enableDeepseekDm = await getSetting<boolean>("features.enableDeepseekDm", true);
    if (!enableDeepseekDm) {
      ack?.({ ok: false, error: "DM 模块已在后台关闭" });
      return;
    }

    const roomId = String(payload?.roomId ?? "").trim();
    const text = String(payload?.text ?? "").trim();
    if (!roomId || !text) {
      ack?.({ ok: false, error: "roomId/text 不能为空" });
      return;
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      ack?.({ ok: false, error: "房间不存在" });
      return;
    }

    // 确保成员关系存在
    await prisma.roomMember.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { userId, roomId, role: "PLAYER" },
      update: {}
    });

    const messageId = nanoid(12);
    ack?.({ ok: true, messageId });

    try {
      // 最近聊天作为上下文（后续会替换为 Campaign 状态 + 剧本摘要）
      const history = await prisma.message.findMany({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        take: 30
      });

      const contextLines = history
        .reverse()
        .map((m) => `${m.authorName}：${m.text}`)
        .join("\n");

      const campaign = await prisma.campaign.findUnique({
        where: { roomId },
        include: { moduleVersion: { include: { module: true } } }
      });

      const moduleText = campaign?.moduleVersion?.markdown ?? "";
      const moduleTitle = campaign?.moduleVersion?.module?.title ?? "（未绑定剧本）";
      const modulePreview = moduleText ? moduleText.slice(0, 8000) : "（未绑定剧本）";
      const stateJson = campaign?.stateJson ?? {};

      const dm = getDmProvider();
      const system = [
        "你是一个专业且严谨的 DND（龙与地下城）文字游戏 DM。",
        "目标：在保证故事连贯与规则合理的前提下推进剧情。",
        "要求：输出简洁但有画面感；需要检定时明确指出检定项与DC；不要替玩家做决定。",
        "注意：这是多人房间，你可以点名某个玩家提问。"
      ].join("\n");

      const userPrompt = [
        `房间：${room.name}`,
        `当前绑定剧本：${moduleTitle}`,
        `玩家 ${userName} 的行动：${text}`,
        "",
        "当前 Campaign 状态（JSON）：",
        JSON.stringify(stateJson),
        "",
        "剧本内容（截断预览，可能不完整）：",
        modulePreview,
        "",
        "最近对话记录：",
        contextLines || "<无>"
      ].join("\n");

      let full = "";
      await dm.generate({
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt }
        ],
        onDelta: (delta) => {
          full += delta;
          io.to(roomId).emit(EVENTS.ROOM_DM_DELTA, { roomId, messageId, delta });
        }
      });

      const dbMsg = await prisma.message.create({
        data: {
          roomId,
          kind: "DM",
          text: full || "（DM 无输出）",
          authorName: "DM"
        }
      });

      const message: ChatMessage = {
        id: dbMsg.id,
        roomId: dbMsg.roomId,
        kind: "DM",
        user: { id: "dm", name: "DM" },
        text: dbMsg.text,
        createdAt: dbMsg.createdAt.getTime()
      };

      io.to(roomId).emit(EVENTS.ROOM_DM_DONE, { roomId, requestId: messageId, message });
    } catch (e: any) {
      io.to(roomId).emit(EVENTS.ROOM_ERROR, { error: `DM 调用失败：${String(e?.message ?? e)}` });
    }
  });
});

// ====== Dice（HTTP：掷骰落库）=====
app.post("/api/rooms/:roomId/dice/roll", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });

  const roomId = String(req.params.roomId ?? "").trim();
  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: jwtUser.userId, roomId } } });
  if (!member) return res.status(403).json({ ok: false, error: "你不在该房间中" });

  const parsed = zDiceRoll.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  let resultText = "";
  try {
    const r = rollDice(parsed.data.expression);
    resultText = `[Dice] ${jwtUser.name} 掷骰：${r.detail}`;
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }

  const dbMsg = await prisma.message.create({
    data: {
      roomId,
      kind: "SYSTEM",
      text: resultText,
      authorName: "骰子"
    }
  });

  const message: ChatMessage = {
    id: dbMsg.id,
    roomId: dbMsg.roomId,
    kind: "SYSTEM",
    user: { id: "system", name: "骰子" },
    text: dbMsg.text,
    createdAt: dbMsg.createdAt.getTime()
  };

  // 直接通过 Socket.IO 广播（如果有在线房间）
  io.to(roomId).emit(EVENTS.ROOM_CHAT_MESSAGE, { message });

  res.json({ ok: true });
});

// ====== Admin（后台）=====
app.get("/api/admin/overview", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const [users, rooms, modules, messages] = await Promise.all([
    prisma.user.count(),
    prisma.room.count(),
    prisma.module.count(),
    prisma.message.count()
  ]);

  const enableItemImages = await getSetting<boolean>("features.enableItemImages", false);
  const enableDeepseekDm = await getSetting<boolean>("features.enableDeepseekDm", true);
  const enableBotApi = await getSetting<boolean>("features.enableBotApi", true);
  const enableOnebotAdapter = await getSetting<boolean>("features.enableOnebotAdapter", true);
  const assetsBaseUrl = await getSetting<string>("assets.baseUrl", "");
  const deepseekModel = await getSetting<string>("deepseek.model", config.deepseek.model);

  res.json({
    ok: true,
    counts: { users, rooms, modules, messages },
    settings: { enableItemImages, enableDeepseekDm, enableBotApi, enableOnebotAdapter, assetsBaseUrl, deepseekModel }
  });
});

app.get("/api/admin/settings", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const enableItemImages = await getSetting<boolean>("features.enableItemImages", false);
  const enableDeepseekDm = await getSetting<boolean>("features.enableDeepseekDm", true);
  const enableBotApi = await getSetting<boolean>("features.enableBotApi", true);
  const enableOnebotAdapter = await getSetting<boolean>("features.enableOnebotAdapter", true);
  const assetsBaseUrl = await getSetting<string>("assets.baseUrl", "");
  const onebotBaseUrl = await getSetting<string>("onebot.baseUrl", "");
  const deepseekBaseUrl = await getSetting<string>("deepseek.baseUrl", config.deepseek.baseUrl);
  const deepseekModel = await getSetting<string>("deepseek.model", config.deepseek.model);
  const deepseekApiKey = await getSetting<string>("deepseek.apiKey", config.deepseek.apiKey);

  res.json({
    ok: true,
    settings: {
      enableItemImages,
      enableDeepseekDm,
      enableBotApi,
      enableOnebotAdapter,
      assetsBaseUrl,
      onebotBaseUrl,
      deepseekBaseUrl,
      deepseekModel,
      // 出于安全考虑只返回是否已配置（不回传明文）
      deepseekHasApiKey: Boolean(deepseekApiKey)
    }
  });
});

app.put("/api/admin/settings", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const enableItemImages = Boolean(req.body?.enableItemImages);
  const enableDeepseekDm = Boolean(req.body?.enableDeepseekDm);
  const enableBotApi = Boolean(req.body?.enableBotApi);
  const enableOnebotAdapter = Boolean(req.body?.enableOnebotAdapter);
  const assetsBaseUrl = String(req.body?.assetsBaseUrl ?? "").trim();
  const onebotBaseUrl = String(req.body?.onebotBaseUrl ?? "").trim();
  const deepseekBaseUrl = String(req.body?.deepseekBaseUrl ?? "").trim();
  const deepseekModel = String(req.body?.deepseekModel ?? "").trim();
  const deepseekApiKey = String(req.body?.deepseekApiKey ?? "").trim();
  const deepseekClearApiKey = Boolean(req.body?.deepseekClearApiKey);

  await Promise.all([
    setSetting("features.enableItemImages", enableItemImages),
    setSetting("features.enableDeepseekDm", enableDeepseekDm),
    setSetting("features.enableBotApi", enableBotApi),
    setSetting("features.enableOnebotAdapter", enableOnebotAdapter),
    setSetting("assets.baseUrl", assetsBaseUrl),
    setSetting("onebot.baseUrl", onebotBaseUrl),
    setSetting("deepseek.baseUrl", deepseekBaseUrl || config.deepseek.baseUrl),
    setSetting("deepseek.model", deepseekModel || config.deepseek.model)
  ]);

  // apiKey 单独处理：空字符串默认“保持不变”，除非显式 clear 或提供新 key
  if (deepseekClearApiKey) {
    await setSetting("deepseek.apiKey", "");
  } else if (deepseekApiKey) {
    await setSetting("deepseek.apiKey", deepseekApiKey);
  }

  res.json({ ok: true });
});

// ====== Admin：资源（Assets / Items）=====
app.get("/api/admin/assets", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const rows = await prisma.asset.findMany({ orderBy: { updatedAt: "desc" } });
  res.json({ ok: true, assets: rows });
});

app.post("/api/admin/assets", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const key = String(req.body?.key ?? "").trim();
  const url = String(req.body?.url ?? "").trim();
  const mimeType = String(req.body?.mimeType ?? "").trim() || null;
  if (!key || !url) return res.status(400).json({ ok: false, error: "key/url 不能为空" });

  const row = await prisma.asset.create({ data: { key, url, mimeType } }).catch(() => null);
  if (!row) return res.status(400).json({ ok: false, error: "创建失败（key 可能已存在）" });
  res.json({ ok: true, asset: row });
});

app.put("/api/admin/assets/:key", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const key = String(req.params.key ?? "").trim();
  const url = String(req.body?.url ?? "").trim();
  const mimeType = String(req.body?.mimeType ?? "").trim() || null;
  if (!key || !url) return res.status(400).json({ ok: false, error: "key/url 不能为空" });

  const row = await prisma.asset.update({ where: { key }, data: { url, mimeType } }).catch(() => null);
  if (!row) return res.status(404).json({ ok: false, error: "asset 不存在" });
  res.json({ ok: true, asset: row });
});

app.delete("/api/admin/assets/:key", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const key = String(req.params.key ?? "").trim();
  if (!key) return res.status(400).json({ ok: false, error: "key 不能为空" });
  await prisma.asset.delete({ where: { key } }).catch(() => null);
  res.json({ ok: true });
});

app.get("/api/admin/items", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const rows = await prisma.item.findMany({
    orderBy: { updatedAt: "desc" },
    include: { imageAsset: true }
  });

  const enableItemImages = await getSetting<boolean>("features.enableItemImages", false);
  const items = await Promise.all(
    rows.map(async (it) => ({
      ...it,
      imageUrl: enableItemImages && it.imageAsset?.url ? await resolveAssetUrl(it.imageAsset.url) : null
    }))
  );

  res.json({ ok: true, items });
});

app.post("/api/admin/items", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const kind = String(req.body?.kind ?? "ITEM").toUpperCase();
  const name = String(req.body?.name ?? "").trim();
  const description = String(req.body?.description ?? "").trim() || null;
  const imageAssetKey = String(req.body?.imageAssetKey ?? "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "name 不能为空" });
  if (kind !== "ITEM" && kind !== "EQUIPMENT") return res.status(400).json({ ok: false, error: "kind 不合法" });

  const asset = imageAssetKey ? await prisma.asset.findUnique({ where: { key: imageAssetKey } }) : null;
  const row = await prisma.item.create({
    data: {
      kind: kind as any,
      name,
      description,
      imageAssetId: asset?.id ?? null,
      metaJson: {}
    }
  });

  res.json({ ok: true, item: row });
});

app.put("/api/admin/items/:id", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const id = String(req.params.id ?? "").trim();
  const kind = String(req.body?.kind ?? "").toUpperCase();
  const name = String(req.body?.name ?? "").trim();
  const description = String(req.body?.description ?? "").trim() || null;
  const imageAssetKey = String(req.body?.imageAssetKey ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id 不能为空" });
  if (!name) return res.status(400).json({ ok: false, error: "name 不能为空" });
  if (kind !== "ITEM" && kind !== "EQUIPMENT") return res.status(400).json({ ok: false, error: "kind 不合法" });

  const asset = imageAssetKey ? await prisma.asset.findUnique({ where: { key: imageAssetKey } }) : null;
  const row = await prisma.item
    .update({
      where: { id },
      data: { kind: kind as any, name, description, imageAssetId: asset?.id ?? null }
    })
    .catch(() => null);
  if (!row) return res.status(404).json({ ok: false, error: "item 不存在" });
  res.json({ ok: true, item: row });
});

app.delete("/api/admin/items/:id", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id 不能为空" });
  await prisma.item.delete({ where: { id } }).catch(() => null);
  res.json({ ok: true });
});

app.get("/api/admin/onebot/bindings", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const rows = await prisma.oneBotGroupBinding.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ ok: true, bindings: rows });
});

app.put("/api/admin/onebot/bindings", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const parsed = zUpsertOnebotBinding.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  // 确保 room 存在
  const room = await prisma.room.findUnique({ where: { id: parsed.data.roomId } });
  if (!room) return res.status(404).json({ ok: false, error: "房间不存在" });

  const row = await prisma.oneBotGroupBinding.upsert({
    where: { groupId: parsed.data.groupId },
    create: { groupId: parsed.data.groupId, roomId: parsed.data.roomId },
    update: { roomId: parsed.data.roomId }
  });

  res.json({ ok: true, binding: row });
});

app.delete("/api/admin/onebot/bindings/:groupId", async (req, res) => {
  const jwtUser = requireHttpAuth(req);
  if (!jwtUser) return res.status(401).json({ ok: false, error: "未登录" });
  if (!requireAdminOr403(res, jwtUser)) return;

  const groupId = String(req.params.groupId ?? "").trim();
  if (!groupId) return res.status(400).json({ ok: false, error: "groupId 不能为空" });
  await prisma.oneBotGroupBinding.delete({ where: { groupId } }).catch(() => null);
  res.json({ ok: true });
});

// ====== Bot API（供 OneBot adapter 等外部模块调用，独立密钥开关）=====
app.get("/api/bot/features", async (req, res) => {
  if (!requireBotOr403(req, res)) return;

  const enableBotApi = await getSetting<boolean>("features.enableBotApi", true);
  const enableOnebotAdapter = await getSetting<boolean>("features.enableOnebotAdapter", true);
  const enableDeepseekDm = await getSetting<boolean>("features.enableDeepseekDm", true);
  const enableItemImages = await getSetting<boolean>("features.enableItemImages", false);

  res.json({ ok: true, features: { enableBotApi, enableOnebotAdapter, enableDeepseekDm, enableItemImages } });
});

app.get("/api/bot/onebot/bindings", async (req, res) => {
  if (!requireBotOr403(req, res)) return;
  const enableBotApi = await getSetting<boolean>("features.enableBotApi", true);
  const enableOnebotAdapter = await getSetting<boolean>("features.enableOnebotAdapter", true);
  if (!enableBotApi) return res.status(503).json({ ok: false, error: "Bot API 已在后台关闭" });
  if (!enableOnebotAdapter) return res.status(503).json({ ok: false, error: "OneBot 模块已在后台关闭" });
  const rows = await prisma.oneBotGroupBinding.findMany();
  res.json({ ok: true, bindings: rows.map((x) => ({ groupId: x.groupId, roomId: x.roomId })) });
});

app.post("/api/bot/rooms/:roomId/messages", async (req, res) => {
  if (!requireBotOr403(req, res)) return;
  const enableBotApi = await getSetting<boolean>("features.enableBotApi", true);
  const enableOnebotAdapter = await getSetting<boolean>("features.enableOnebotAdapter", true);
  if (!enableBotApi) return res.status(503).json({ ok: false, error: "Bot API 已在后台关闭" });
  if (!enableOnebotAdapter) return res.status(503).json({ ok: false, error: "OneBot 模块已在后台关闭" });

  const roomId = String(req.params.roomId ?? "").trim();
  const parsed = zBotPostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "参数不合法" });

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ ok: false, error: "房间不存在" });

  const kind = parsed.data.kind ?? "CHAT";
  const dbMsg = await prisma.message.create({
    data: {
      roomId,
      kind: kind as any,
      text: parsed.data.text,
      authorName: parsed.data.authorName
    }
  });

  const user =
    kind === "DM" ? { id: "dm", name: "DM" } : kind === "SYSTEM" ? { id: "system", name: parsed.data.authorName } : { id: "bot", name: parsed.data.authorName };

  const message: ChatMessage = {
    id: dbMsg.id,
    roomId: dbMsg.roomId,
    kind: kind as any,
    user,
    text: dbMsg.text,
    createdAt: dbMsg.createdAt.getTime()
  };

  io.to(roomId).emit(EVENTS.ROOM_CHAT_MESSAGE, { message });
  res.json({ ok: true });
});

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${config.port}`);
});
