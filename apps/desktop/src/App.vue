<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { io, type Socket } from "socket.io-client";
import { EVENTS, type ChatMessage, type ClientToServerEvents, type ServerToClientEvents } from "@dnd/shared";

type ApiOk<T> = { ok: true } & T;
type ApiFail = { ok: false; error: string };

type AuthOk = ApiOk<{ token: string; user: { id: string; name: string } }>;
type RoomOk = ApiOk<{ room: { id: string; name: string; inviteCode?: string } }>;

type ModuleRow = {
  id: string;
  title: string;
  description: string | null;
  updatedAt: string;
  versions?: Array<{ id: string; version: number; createdAt: string }>;
};

type CampaignRow = {
  id: string;
  roomId: string;
  moduleVersionId: string | null;
  stateJson: any;
  moduleVersion?: { id: string; version: number; markdown: string; module: { id: string; title: string } } | null;
};

const serverUrl = ref("http://localhost:8787");

// ===== 账号 =====
const authMode = ref<"dev" | "login" | "register">("dev");
const name = ref("");
const email = ref("");
const password = ref("");
const token = ref("");

// ===== 房间 =====
const roomId = ref("");
const roomName = ref("");
const roomInviteCode = ref("");
const newRoomName = ref("新房间");
const inviteCodeToJoin = ref("");

// ===== 剧本/版本 =====
const modules = ref<ModuleRow[]>([]);
const moduleTitle = ref("");
const moduleDesc = ref("");
const selectedModuleId = ref("");
const versions = ref<Array<{ id: string; version: number; createdAt: string }>>([]);
const selectedModuleVersionId = ref("");
const markdown = ref("# 剧本标题\n\n在这里粘贴/编写你的 Markdown 剧本内容…\n");

// ===== Campaign/存档 =====
const campaign = ref<CampaignRow | null>(null);
const saveName = ref("自动存档");
const saves = ref<Array<{ id: string; name: string; createdAt: string }>>([]);
const selectedSaveId = ref("");

// ===== 实时聊天 =====
const socketStatus = ref<"disconnected" | "connecting" | "connected">("disconnected");
const errorText = ref("");
const messages = ref<ChatMessage[]>([]);
const chatText = ref("");
const dmText = ref("");
const diceExpr = ref("d20");
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

function apiBase() {
  return serverUrl.value.replace(/\/$/, "");
}

function authHeaders() {
  const headers: Record<string, string> = {};
  if (token.value) headers.Authorization = `Bearer ${token.value}`;
  return headers;
}

function addMessage(m: ChatMessage) {
  if (messages.value.some((x) => x.id === m.id)) return;
  messages.value.push(m);
}

const canConnect = computed(() => !!serverUrl.value.trim());
const canAuth = computed(() => {
  if (!canConnect.value) return false;
  if (authMode.value === "dev") return !!name.value.trim();
  if (authMode.value === "login") return !!email.value.trim() && !!password.value;
  return !!name.value.trim() && !!email.value.trim() && password.value.length >= 6;
});
const canCreateRoom = computed(() => socketStatus.value === "connected" && !!token.value);
const canJoinById = computed(() => socketStatus.value === "connected" && !!roomId.value.trim());
const canJoinByInvite = computed(() => socketStatus.value === "connected" && !!inviteCodeToJoin.value.trim());
const canSend = computed(() => socketStatus.value === "connected" && !!roomId.value.trim() && !!chatText.value.trim());
const canDm = computed(() => socketStatus.value === "connected" && !!roomId.value.trim() && !!dmText.value.trim());
const canRoll = computed(() => !!token.value && !!roomId.value.trim() && !!diceExpr.value.trim());
const canCreateModule = computed(() => !!token.value && !!moduleTitle.value.trim());
const canCreateVersion = computed(() => !!token.value && !!selectedModuleId.value && !!markdown.value.trim());
const canBindModule = computed(() => !!token.value && !!roomId.value.trim() && !!selectedModuleVersionId.value.trim());
const canSave = computed(() => !!token.value && !!roomId.value.trim() && !!saveName.value.trim());
const canLoad = computed(() => !!token.value && !!roomId.value.trim() && !!selectedSaveId.value.trim());

async function doAuth() {
  errorText.value = "";
  messages.value = [];
  roomName.value = "";
  roomInviteCode.value = "";
  campaign.value = null;
  token.value = "";

  socket?.disconnect();
  socket = null;
  socketStatus.value = "disconnected";

  let url = "";
  let body: any = {};
  if (authMode.value === "dev") {
    url = `${apiBase()}/api/auth/dev-login`;
    body = { name: name.value };
  } else if (authMode.value === "login") {
    url = `${apiBase()}/api/auth/login`;
    body = { email: email.value, password: password.value };
  } else {
    url = `${apiBase()}/api/auth/register`;
    body = { name: name.value, email: email.value, password: password.value };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = (await resp.json()) as AuthOk | ApiFail;
  if (!data.ok) {
    errorText.value = data.error;
    return;
  }

  token.value = data.token;
  connectSocket();
  await fetchModules();
}

function connectSocket() {
  if (!token.value) return;
  errorText.value = "";
  socketStatus.value = "connecting";

  socket = io(serverUrl.value, { transports: ["websocket"], autoConnect: true });

  socket.on("connect", () => {
    socketStatus.value = "connected";
    socket?.emit(EVENTS.CLIENT_HELLO, { token: token.value }, (ack) => {
      if (!ack?.ok) errorText.value = ack?.error ?? "认证失败";
    });
  });

  socket.on("disconnect", () => {
    socketStatus.value = "disconnected";
  });

  socket.on(EVENTS.SERVER_WELCOME, (payload) => {
    addMessage({
      id: `sys_${Date.now()}`,
      roomId: roomId.value || "lobby",
      kind: "SYSTEM",
      user: { id: "system", name: "系统" },
      text: `已连接服务器，欢迎你：${payload.user.name}`,
      createdAt: Date.now()
    });
  });

  socket.on(EVENTS.ROOM_JOINED, (payload) => {
    roomName.value = payload.room.name;
    roomInviteCode.value = payload.room.inviteCode ?? roomInviteCode.value;
  });

  socket.on(EVENTS.ROOM_CHAT_MESSAGE, (payload) => addMessage(payload.message));

  socket.on(EVENTS.ROOM_DM_DELTA, (payload) => {
    const idx = messages.value.findIndex((m) => m.id === payload.messageId);
    if (idx >= 0) {
      messages.value[idx].text += payload.delta;
      return;
    }
    addMessage({
      id: payload.messageId,
      roomId: payload.roomId,
      kind: "DM",
      user: { id: "dm", name: "DM" },
      text: payload.delta,
      createdAt: Date.now()
    });
  });

  socket.on(EVENTS.ROOM_DM_DONE, (payload) => {
    const idx = messages.value.findIndex((m) => m.id === payload.requestId);
    if (idx >= 0) {
      messages.value[idx] = payload.message;
      return;
    }
    addMessage(payload.message);
  });

  socket.on(EVENTS.ROOM_ERROR, (payload) => {
    errorText.value = payload.error;
  });
}

async function createRoom() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name: newRoomName.value })
  });
  const data = (await resp.json()) as RoomOk | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  roomId.value = data.room.id;
  roomName.value = data.room.name;
  roomInviteCode.value = data.room.inviteCode ?? "";
  joinRoom();
}

async function joinByInvite() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ inviteCode: inviteCodeToJoin.value.trim() })
  });
  const data = (await resp.json()) as RoomOk | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  roomId.value = data.room.id;
  roomName.value = data.room.name;
  roomInviteCode.value = data.room.inviteCode ?? "";
  joinRoom();
}

function joinRoom() {
  if (!socket) return;
  errorText.value = "";
  messages.value = [];
  roomName.value = roomName.value; // 保留已有

  socket.emit(EVENTS.ROOM_JOIN, { roomId: roomId.value.trim() }, async (ack) => {
    if (!ack?.ok) {
      errorText.value = ack?.error ?? "加入房间失败";
      return;
    }
    roomName.value = ack.room.name;
    roomInviteCode.value = ack.room.inviteCode ?? roomInviteCode.value;
    await fetchHistory();
    await fetchCampaign();
    await fetchSaves();
  });
}

function sendChat() {
  if (!socket) return;
  const text = chatText.value.trim();
  if (!text) return;
  chatText.value = "";
  socket.emit(EVENTS.ROOM_CHAT_SEND, { roomId: roomId.value.trim(), text }, (ack) => {
    if (!ack?.ok) errorText.value = ack?.error ?? "发送失败";
  });
}

async function fetchHistory() {
  if (!token.value || !roomId.value.trim()) return;
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/messages?limit=50`, {
    headers: authHeaders()
  });
  const data = (await resp.json()) as ApiOk<{ messages: ChatMessage[] }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  messages.value = data.messages;
}

function requestDm() {
  if (!socket) return;
  const text = dmText.value.trim();
  if (!text) return;
  dmText.value = "";
  socket.emit(EVENTS.ROOM_DM_REQUEST, { roomId: roomId.value.trim(), text }, (ack) => {
    if (!ack?.ok) return (errorText.value = ack?.error ?? "DM 请求失败");
    addMessage({
      id: ack.messageId,
      roomId: roomId.value.trim(),
      kind: "DM",
      user: { id: "dm", name: "DM" },
      text: "",
      createdAt: Date.now()
    });
  });
}

async function rollDiceHttp() {
  if (!token.value || !roomId.value.trim()) return;
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/dice/roll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ expression: diceExpr.value })
  });
  const data = (await resp.json().catch(() => ({ ok: resp.ok }))) as { ok: true } | ApiFail;
  if (!data.ok) {
    errorText.value = (data as any).error ?? "掷骰失败";
    return;
  }
}

// ===== 剧本 API =====
async function fetchModules() {
  if (!token.value) return;
  const resp = await fetch(`${apiBase()}/api/modules`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ modules: ModuleRow[] }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  modules.value = data.modules;
}

async function createModule() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/modules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title: moduleTitle.value, description: moduleDesc.value || undefined })
  });
  const data = (await resp.json()) as ApiOk<{ module: ModuleRow }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  moduleTitle.value = "";
  moduleDesc.value = "";
  await fetchModules();
  selectedModuleId.value = data.module.id;
  await fetchVersions();
}

async function fetchVersions() {
  if (!token.value || !selectedModuleId.value) return;
  const resp = await fetch(`${apiBase()}/api/modules/${selectedModuleId.value}/versions`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ versions: Array<{ id: string; version: number; createdAt: string }> }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  versions.value = data.versions;
  if (!selectedModuleVersionId.value && versions.value[0]) selectedModuleVersionId.value = versions.value[0].id;
}

async function createVersion() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/modules/${selectedModuleId.value}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ markdown: markdown.value })
  });
  const data = (await resp.json()) as ApiOk<{ moduleVersion: { id: string } }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await fetchVersions();
  selectedModuleVersionId.value = data.moduleVersion.id;
  await fetchModules();
}

async function bindModuleToRoom() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/campaign/bind-module`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ moduleVersionId: selectedModuleVersionId.value })
  });
  const data = (await resp.json()) as ApiOk<{ campaign: CampaignRow }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await fetchCampaign();
}

// ===== Campaign/存档 API =====
async function fetchCampaign() {
  if (!token.value || !roomId.value.trim()) return;
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/campaign`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ campaign: CampaignRow }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  campaign.value = data.campaign;
}

async function fetchSaves() {
  if (!token.value || !roomId.value.trim()) return;
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/campaign/saves`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ saves: Array<{ id: string; name: string; createdAt: string }> }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  saves.value = data.saves;
  if (!selectedSaveId.value && saves.value[0]) selectedSaveId.value = saves.value[0].id;
}

async function createSave() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/campaign/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name: saveName.value })
  });
  const data = (await resp.json()) as ApiOk<{ save: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await fetchSaves();
}

async function loadSave() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/rooms/${roomId.value.trim()}/campaign/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ saveId: selectedSaveId.value })
  });
  const data = (await resp.json()) as ApiOk<{ campaign: CampaignRow }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await fetchCampaign();
}

// ===== UI helper =====
const chatEl = ref<HTMLDivElement | null>(null);
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  }
);

watch(selectedModuleId, () => {
  versions.value = [];
  selectedModuleVersionId.value = "";
  fetchVersions();
});

onMounted(() => {
  // 方便本地刷新调试时快速继续
  try {
    const savedUrl = localStorage.getItem("dnd_server_url");
    if (savedUrl) serverUrl.value = savedUrl;
  } catch {}
});

watch(serverUrl, (v) => {
  try {
    localStorage.setItem("dnd_server_url", v);
  } catch {}
});

onBeforeUnmount(() => socket?.disconnect());
</script>

<template>
  <div class="container">
    <h1 style="margin: 0 0 10px">DND Online（V1 进行中）</h1>
    <div class="muted" style="margin-bottom: 16px">当前是 Web UI（Vite）形态；后续可直接包进 Electron。</div>

    <div class="card" style="margin-bottom: 12px">
      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">服务器地址</div>
          <input v-model="serverUrl" placeholder="http://localhost:8787" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">登录方式</div>
          <div style="display: flex; gap: 8px">
            <button :disabled="authMode === 'dev'" @click="authMode = 'dev'">开发登录</button>
            <button :disabled="authMode === 'login'" @click="authMode = 'login'">登录</button>
            <button :disabled="authMode === 'register'" @click="authMode = 'register'">注册</button>
          </div>
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <div v-if="authMode !== 'login'">
          <div class="muted" style="margin-bottom: 6px">昵称</div>
          <input v-model="name" placeholder="例如：阿尔贡" />
        </div>
        <div v-else>
          <div class="muted" style="margin-bottom: 6px">邮箱</div>
          <input v-model="email" placeholder="you@example.com" />
        </div>
        <div v-if="authMode !== 'dev'">
          <div class="muted" style="margin-bottom: 6px">密码</div>
          <input v-model="password" type="password" placeholder="至少6位" />
        </div>
        <div v-else>
          <div class="muted" style="margin-bottom: 6px">Socket 状态</div>
          <input :value="socketStatus" disabled />
        </div>
      </div>

      <div v-if="authMode === 'register'" style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">邮箱</div>
        <input v-model="email" placeholder="you@example.com" />
      </div>

      <div style="display: flex; gap: 10px; margin-top: 12px; align-items: center">
        <button :disabled="!canAuth" @click="doAuth">认证并连接</button>
        <div class="muted">Socket：{{ socketStatus }}</div>
      </div>
      <div v-if="token" class="muted" style="margin-top: 10px">token：{{ token }}</div>
      <div v-if="errorText" style="margin-top: 10px; color: #ff6b6b">{{ errorText }}</div>
    </div>

    <div class="card" style="margin-bottom: 12px">
      <div class="muted" style="margin-bottom: 8px">房间</div>

      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">房间 ID</div>
          <input v-model="roomId" placeholder="直接输入 roomId 加入" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">邀请码</div>
          <input v-model="inviteCodeToJoin" placeholder="输入邀请码加入" />
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px; align-items: center">
        <button :disabled="!canJoinById" @click="joinRoom">按ID加入</button>
        <button :disabled="!canJoinByInvite" @click="joinByInvite">按邀请码加入</button>
        <div style="flex: 1"></div>
        <input v-model="newRoomName" style="max-width: 240px" placeholder="新房间名称" />
        <button :disabled="!canCreateRoom" @click="createRoom">创建房间</button>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">当前房间名</div>
          <input :value="roomName" disabled />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">当前邀请码</div>
          <input :value="roomInviteCode" disabled placeholder="加入房间后显示" />
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 12px">
      <div class="muted" style="margin-bottom: 8px">剧本（Markdown）</div>

      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">新建剧本标题</div>
          <input v-model="moduleTitle" placeholder="例如：迷雾小镇" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">描述（可选）</div>
          <input v-model="moduleDesc" placeholder="一句话简介" />
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button :disabled="!canCreateModule" @click="createModule">创建剧本</button>
        <button :disabled="!token" @click="fetchModules">刷新列表</button>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">选择剧本</div>
          <select v-model="selectedModuleId" style="width: 100%; padding: 10px 12px; border-radius: 8px">
            <option value="">（请选择）</option>
            <option v-for="m in modules" :key="m.id" :value="m.id">
              {{ m.title }}
            </option>
          </select>
          <div class="muted" style="margin-top: 6px">版本数：{{ versions.length }}</div>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">选择版本（用于绑定房间）</div>
          <select v-model="selectedModuleVersionId" style="width: 100%; padding: 10px 12px; border-radius: 8px">
            <option value="">（请选择）</option>
            <option v-for="v in versions" :key="v.id" :value="v.id">v{{ v.version }}（{{ v.id.slice(0, 8) }}）</option>
          </select>
          <div style="display: flex; gap: 10px; margin-top: 12px">
            <button :disabled="!canBindModule" @click="bindModuleToRoom">绑定到当前房间</button>
            <button :disabled="!selectedModuleId" @click="fetchVersions">刷新版本</button>
          </div>
        </div>
      </div>

      <div style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">编写/粘贴 Markdown，并创建新版本</div>
        <textarea
          v-model="markdown"
          style="width: 100%; height: 180px; padding: 10px 12px; border-radius: 8px; background: #0f1218; color: #eaeaea; border: 1px solid #232a36"
        />
        <div style="display: flex; gap: 10px; margin-top: 12px">
          <button :disabled="!canCreateVersion" @click="createVersion">创建新版本</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 12px">
      <div class="muted" style="margin-bottom: 8px">Campaign / 存档</div>
      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">当前绑定剧本</div>
          <input :value="campaign?.moduleVersion?.module?.title ?? '（未绑定）'" disabled />
          <div class="muted" style="margin-top: 6px">stateJson：{{ JSON.stringify(campaign?.stateJson ?? {}) }}</div>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">存档名</div>
          <input v-model="saveName" placeholder="例如：进入地城前" />
          <div style="display: flex; gap: 10px; margin-top: 12px">
            <button :disabled="!canSave" @click="createSave">存档</button>
            <button :disabled="!token || !roomId" @click="fetchSaves">刷新存档列表</button>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">选择存档</div>
          <select v-model="selectedSaveId" style="width: 100%; padding: 10px 12px; border-radius: 8px">
            <option value="">（请选择）</option>
            <option v-for="s in saves" :key="s.id" :value="s.id">{{ s.name }}（{{ s.id.slice(0, 8) }}）</option>
          </select>
          <div style="display: flex; gap: 10px; margin-top: 12px">
            <button :disabled="!canLoad" @click="loadSave">读档（仅GM）</button>
            <button :disabled="!token || !roomId" @click="fetchCampaign">刷新Campaign</button>
          </div>
        </div>
        <div class="muted">
          提示：目前 stateJson 还没做自动状态推进（后续会让 DM 输出结构化指令来更新状态）。
        </div>
      </div>
    </div>

    <div class="card">
      <div class="muted" style="margin-bottom: 8px">房间聊天 / DM</div>
      <div ref="chatEl" class="chat">
        <div v-for="m in messages" :key="m.id" class="msg">
          <div class="meta">[{{ new Date(m.createdAt).toLocaleTimeString() }}] {{ m.user.name }}（{{ m.kind }}）</div>
          <div class="text">{{ m.text }}</div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <input v-model="chatText" placeholder="输入消息，回车发送" @keydown.enter="sendChat" />
        <button :disabled="!canSend" @click="sendChat">发送</button>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <input v-model="diceExpr" placeholder="掷骰表达式，例如 d20、2d6+3" @keydown.enter="rollDiceHttp" />
        <button :disabled="!canRoll" @click="rollDiceHttp">掷骰</button>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <input v-model="dmText" placeholder="让 DM 响应：例如“我检查门锁是否有陷阱”" @keydown.enter="requestDm" />
        <button :disabled="!canDm" @click="requestDm">请求DM</button>
      </div>
    </div>
  </div>
</template>
