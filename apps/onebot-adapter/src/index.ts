import dotenv from "dotenv";
import { io, type Socket } from "socket.io-client";
import WebSocket, { WebSocketServer } from "ws";

import { EVENTS, type ClientToServerEvents, type ServerToClientEvents, type ChatMessage } from "@dnd/shared";

dotenv.config();

const DND_SERVER_URL = process.env.DND_SERVER_URL ?? "http://localhost:8787";
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const ADAPTER_PORT = Number(process.env.ADAPTER_PORT ?? 6700);
const ONEBOT_ACCESS_TOKEN = (process.env.ONEBOT_ACCESS_TOKEN ?? "").trim();
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();

type Binding = { groupId: string; roomId: string };

type Features = {
  enableBotApi: boolean;
  enableOnebotAdapter: boolean;
  enableDeepseekDm: boolean;
  enableItemImages: boolean;
};

type OneBotEvent =
  | {
      post_type: "message";
      message_type: "group";
      group_id: number;
      message_id: number;
      message: any;
      raw_message?: string;
      sender?: { user_id?: number; nickname?: string; card?: string };
    }
  | Record<string, any>;

type OneBotActionRequest = {
  action: string;
  params?: Record<string, any>;
  echo?: string;
};

function log(...args: any[]) {
  if (LOG_LEVEL === "debug") console.log("[onebot-adapter]", ...args);
}

function info(...args: any[]) {
  console.log("[onebot-adapter]", ...args);
}

function warn(...args: any[]) {
  console.warn("[onebot-adapter]", ...args);
}

function pickText(message: any): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    // OneBot 11: message array（segment）
    return message
      .map((seg) => {
        if (!seg) return "";
        if (seg.type === "text") return String(seg.data?.text ?? "");
        // 其他 segment 先降级为可读占位，后续可扩展图片/at 等
        if (seg.type === "at") return `@${seg.data?.qq ?? ""}`;
        return `[${seg.type}]`;
      })
      .join("");
  }
  return String(message ?? "");
}

async function botFetch(path: string, init?: RequestInit) {
  if (!BOT_TOKEN) throw new Error("未配置 BOT_TOKEN（onebot-adapter 无法调用主服务 Bot API）");
  const url = `${DND_SERVER_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = { "X-BOT-TOKEN": BOT_TOKEN };
  if (init?.headers) Object.assign(headers, init.headers as any);
  const resp = await fetch(url, { ...init, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error ?? `HTTP ${resp.status}`);
  }
  return data;
}

// ====== OneBot reverse WS server ======
const wss = new WebSocketServer({ port: ADAPTER_PORT });
let onebotWs: WebSocket | null = null;

wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("access_token") ?? "";
    if (ONEBOT_ACCESS_TOKEN && token !== ONEBOT_ACCESS_TOKEN) {
      warn("OneBot 连接被拒绝：access_token 不匹配");
      ws.close(1008, "invalid access_token");
      return;
    }
  } catch {
    // ignore
  }

  onebotWs = ws;
  info(`OneBot 已连接（reverse WS）`);

  ws.on("message", async (buf) => {
    const raw = buf.toString("utf8");
    log("<= onebot", raw);
    let evt: OneBotEvent;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }

    // 模块被后台关闭时：忽略一切入站消息
    if (!features.enableBotApi || !features.enableOnebotAdapter) return;

    // 只处理群消息
    if (evt.post_type === "message" && evt.message_type === "group") {
      const groupId = String(evt.group_id);
      const text = pickText((evt as any).message ?? (evt as any).raw_message ?? "");
      if (!text.trim()) return;

      const binding = bindings.find((b) => b.groupId === groupId);
      if (!binding) return; // 未绑定就忽略

      const nickname = String((evt as any).sender?.card || (evt as any).sender?.nickname || "");
      const qq = String((evt as any).sender?.user_id ?? "");
      const authorName = `QQ:${nickname || qq || "unknown"}`;
      const content = text;

      try {
        await botFetch(`/api/bot/rooms/${binding.roomId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorName, text: content, kind: "CHAT" })
        });
      } catch (e: any) {
        warn("转发到主服务失败：", e?.message ?? e);
      }
    }
  });

  ws.on("close", () => {
    if (onebotWs === ws) onebotWs = null;
    info("OneBot 已断开");
  });
});

function sendToOnebot(req: OneBotActionRequest) {
  const ws = onebotWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const json = JSON.stringify(req);
  log("=> onebot", json);
  ws.send(json);
  return true;
}

// ====== DND server socket client（用于把房间消息转发回 QQ 群）=====
let dndSocket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let bindings: Binding[] = [];
let joinedRooms = new Set<string>();
let features: Features = { enableBotApi: true, enableOnebotAdapter: true, enableDeepseekDm: true, enableItemImages: false };

async function refreshBindings() {
  try {
    const data = await botFetch("/api/bot/onebot/bindings");
    const next: Binding[] = (data.bindings ?? []).map((x: any) => ({ groupId: String(x.groupId), roomId: String(x.roomId) }));
    bindings = next;
  } catch (e: any) {
    warn("拉取绑定失败：", e?.message ?? e);
  }
}

async function refreshFeatures() {
  try {
    const data = await botFetch("/api/bot/features");
    features = data.features ?? features;
  } catch (e: any) {
    // Bot API 关闭/鉴权失败时，adapter 应该“自我禁用”转发能力，而不是疯狂报错
    features = { ...features, enableBotApi: false, enableOnebotAdapter: false };
  }
}

function groupsForRoom(roomId: string) {
  return bindings.filter((b) => b.roomId === roomId).map((b) => b.groupId);
}

function formatForward(msg: ChatMessage) {
  if (msg.kind === "DM") return `[DM] ${msg.text}`;
  if (msg.kind === "SYSTEM") return `[系统] ${msg.text}`;
  return `${msg.user.name}：${msg.text}`;
}

async function ensureJoinedRooms() {
  if (!dndSocket || dndSocket.disconnected) return;
  if (!features.enableBotApi || !features.enableOnebotAdapter) return;
  const roomIds = Array.from(new Set(bindings.map((b) => b.roomId)));
  for (const roomId of roomIds) {
    if (joinedRooms.has(roomId)) continue;
    dndSocket.emit(EVENTS.ROOM_JOIN, { roomId }, (ack) => {
      if (ack?.ok) {
        joinedRooms.add(roomId);
        info(`已加入房间用于转发：${roomId}`);
      }
    });
  }
}

async function startDndSocket() {
  // 这里不需要登录用户；我们用 Socket.IO 只为“订阅房间广播”，但仍要走 JWT 认证
  // 为简化：adapter 使用 dev-login 获取 token（每次启动创建用户），后续可改为固定 bot 用户登录并配置 JWT
  let jwt = "";
  try {
    const resp = await fetch(`${DND_SERVER_URL.replace(/\/$/, "")}/api/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "OneBotRelay" })
    });
    const data = (await resp.json()) as any;
    if (!data.ok) throw new Error(data.error ?? "dev-login failed");
    jwt = data.token;
  } catch (e: any) {
    warn("无法获取 relay token：", e?.message ?? e);
    return;
  }

  dndSocket = io(DND_SERVER_URL, { transports: ["websocket"], autoConnect: true });
  dndSocket.on("connect", () => {
    joinedRooms = new Set();
    dndSocket?.emit(EVENTS.CLIENT_HELLO, { token: jwt }, (ack) => {
      if (!ack?.ok) warn("relay 认证失败：", ack?.error);
    });
  });

  // 为避免“QQ群消息 -> 房间 -> 又转回QQ群”的回环：
  // - 我们约定从 QQ 进来的 authorName 以 `QQ:` 开头
  // - adapter 转发回 QQ 时跳过这类消息
  dndSocket.on(EVENTS.ROOM_CHAT_MESSAGE, (payload) => {
    const msg = payload.message;
    if (!features.enableBotApi || !features.enableOnebotAdapter) return;
    if (msg.user?.name?.startsWith("QQ:")) return;
    const groups = groupsForRoom(msg.roomId);
    if (groups.length === 0) return;

    const text = formatForward(msg);
    for (const g of groups) {
      sendToOnebot({
        action: "send_group_msg",
        params: { group_id: Number(g), message: text }
      });
    }
  });

  dndSocket.on(EVENTS.ROOM_DM_DONE, (payload) => {
    const msg = payload.message;
    if (!features.enableBotApi || !features.enableOnebotAdapter) return;
    const groups = groupsForRoom(msg.roomId);
    if (groups.length === 0) return;
    const text = formatForward(msg);
    for (const g of groups) {
      sendToOnebot({
        action: "send_group_msg",
        params: { group_id: Number(g), message: text }
      });
    }
  });

  dndSocket.on("disconnect", () => {
    joinedRooms = new Set();
  });
}

async function main() {
  info(`adapter listening: ws://localhost:${ADAPTER_PORT}/ (reverse WS)`);
  info(`dnd server: ${DND_SERVER_URL}`);

  await refreshFeatures();
  await refreshBindings();
  await startDndSocket();
  await ensureJoinedRooms();

  // 定时刷新绑定并 join 新房间
  setInterval(async () => {
    await refreshFeatures();
    await refreshBindings();
    await ensureJoinedRooms();
  }, 15_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
