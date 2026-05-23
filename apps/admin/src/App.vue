<script setup lang="ts">
import { computed, ref } from "vue";

type ApiOk<T> = { ok: true } & T;
type ApiFail = { ok: false; error: string };

const serverUrl = ref("http://localhost:8787");
const token = ref("");
const errorText = ref("");

const counts = ref<{ users: number; rooms: number; modules: number; messages: number } | null>(null);
const settings = ref<{
  enableItemImages: boolean;
  enableDeepseekDm: boolean;
  enableBotApi: boolean;
  enableOnebotAdapter: boolean;
  assetsBaseUrl: string;
  onebotBaseUrl: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekHasApiKey: boolean;
} | null>(null);

const deepseekApiKeyInput = ref("");
const deepseekClearApiKey = ref(false);

const bindings = ref<Array<{ id: string; groupId: string; roomId: string; createdAt: string }>>([]);
const bindGroupId = ref("");
const bindRoomId = ref("");

const assets = ref<Array<{ id: string; key: string; url: string; mimeType: string | null; updatedAt: string }>>([]);
const assetKey = ref("");
const assetUrl = ref("");
const assetMime = ref("");

const items = ref<Array<any>>([]);
const itemKind = ref<"ITEM" | "EQUIPMENT">("ITEM");
const itemName = ref("");
const itemDesc = ref("");
const itemImageKey = ref("");

const canLoad = computed(() => !!serverUrl.value.trim() && !!token.value.trim());

function apiBase() {
  return serverUrl.value.replace(/\/$/, "");
}

function authHeaders() {
  return { Authorization: `Bearer ${token.value}` };
}

async function loadOverview() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/overview`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ counts: any; settings: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  counts.value = data.counts;
  // overview 只返回部分 settings，这里继续拉完整
  await loadSettings();
}

async function loadSettings() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/settings`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ settings: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  settings.value = data.settings;
}

async function saveSettings() {
  if (!settings.value) return;
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ...settings.value,
      deepseekApiKey: deepseekApiKeyInput.value.trim() || undefined,
      deepseekClearApiKey: deepseekClearApiKey.value
    })
  });
  const data = (await resp.json()) as ApiOk<{}> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  deepseekApiKeyInput.value = "";
  deepseekClearApiKey.value = false;
  await loadSettings();
}

async function loadBindings() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/onebot/bindings`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ bindings: any[] }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  bindings.value = data.bindings;
}

async function loadAssets() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/assets`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ assets: any[] }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  assets.value = data.assets;
}

async function createAsset() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: assetKey.value.trim(), url: assetUrl.value.trim(), mimeType: assetMime.value.trim() || undefined })
  });
  const data = (await resp.json()) as ApiOk<{ asset: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  assetKey.value = "";
  assetUrl.value = "";
  assetMime.value = "";
  await loadAssets();
}

async function deleteAsset(key: string) {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/assets/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  const data = (await resp.json()) as ApiOk<{}> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await loadAssets();
}

async function loadItems() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/items`, { headers: authHeaders() });
  const data = (await resp.json()) as ApiOk<{ items: any[] }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  items.value = data.items;
}

async function createItem() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      kind: itemKind.value,
      name: itemName.value.trim(),
      description: itemDesc.value.trim() || undefined,
      imageAssetKey: itemImageKey.value.trim() || undefined
    })
  });
  const data = (await resp.json()) as ApiOk<{ item: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  itemName.value = "";
  itemDesc.value = "";
  itemImageKey.value = "";
  await loadItems();
}

async function deleteItem(id: string) {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/items/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  const data = (await resp.json()) as ApiOk<{}> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await loadItems();
}

async function upsertBinding() {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/onebot/bindings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ groupId: bindGroupId.value.trim(), roomId: bindRoomId.value.trim() })
  });
  const data = (await resp.json()) as ApiOk<{ binding: any }> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  bindGroupId.value = "";
  bindRoomId.value = "";
  await loadBindings();
}

async function deleteBinding(groupId: string) {
  errorText.value = "";
  const resp = await fetch(`${apiBase()}/api/admin/onebot/bindings/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  const data = (await resp.json()) as ApiOk<{}> | ApiFail;
  if (!data.ok) return (errorText.value = data.error);
  await loadBindings();
}
</script>

<template>
  <div class="container">
    <h1 style="margin: 0 0 10px">DND Admin</h1>
    <div class="muted" style="margin-bottom: 16px">需要管理员 JWT 才能访问。</div>

    <div class="card" style="margin-bottom: 12px">
      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">服务器地址</div>
          <input v-model="serverUrl" placeholder="http://localhost:8787" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">管理员 JWT</div>
          <input v-model="token" placeholder="粘贴 token（Bearer token 的 token 部分）" />
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button :disabled="!canLoad" @click="loadOverview">加载概览</button>
        <button :disabled="!canLoad" @click="loadSettings">加载设置</button>
        <button :disabled="!canLoad" @click="loadBindings">加载 OneBot 绑定</button>
        <button :disabled="!canLoad" @click="loadAssets">加载资源</button>
        <button :disabled="!canLoad" @click="loadItems">加载道具</button>
      </div>
      <div v-if="errorText" style="margin-top: 10px; color: #ff6b6b">{{ errorText }}</div>
    </div>

    <div v-if="counts" class="card" style="margin-bottom: 12px">
      <div class="muted" style="margin-bottom: 8px">数据概览</div>
      <div class="row">
        <div>用户：{{ counts.users }}</div>
        <div>房间：{{ counts.rooms }}</div>
        <div>剧本：{{ counts.modules }}</div>
        <div>消息：{{ counts.messages }}</div>
      </div>
    </div>

    <div v-if="settings" class="card">
      <div class="muted" style="margin-bottom: 8px">系统设置</div>

      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">道具图片资源开关</div>
          <select v-model="settings.enableItemImages">
            <option :value="true">启用</option>
            <option :value="false">关闭</option>
          </select>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">资源 Base URL（可选）</div>
          <input v-model="settings.assetsBaseUrl" placeholder="例如：https://cdn.example.com/assets" />
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">DeepSeek DM 开关</div>
          <select v-model="settings.enableDeepseekDm">
            <option :value="true">启用</option>
            <option :value="false">关闭</option>
          </select>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">Bot API 开关（OneBot 适配器依赖）</div>
          <select v-model="settings.enableBotApi">
            <option :value="true">启用</option>
            <option :value="false">关闭</option>
          </select>
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">OneBot 模块开关（QQ群转发）</div>
          <select v-model="settings.enableOnebotAdapter">
            <option :value="true">启用</option>
            <option :value="false">关闭</option>
          </select>
        </div>
        <div class="muted">
          说明：关闭后，主服务的 Bot API 会返回 503；onebot-adapter 即使在跑也不会转发消息，相当于“模块关闭”。
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">DeepSeek Base URL</div>
          <input v-model="settings.deepseekBaseUrl" placeholder="例如：https://api.deepseek.com" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">DeepSeek 模型名称</div>
          <input v-model="settings.deepseekModel" placeholder="例如：deepseek-v4-pro" />
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <div>
          <div class="muted" style="margin-bottom: 6px">DeepSeek API Key（不会回显已保存的 key）</div>
          <input v-model="deepseekApiKeyInput" placeholder="留空=保持不变；填入=更新" />
          <div class="muted" style="margin-top: 6px">当前状态：{{ settings.deepseekHasApiKey ? "已配置" : "未配置" }}</div>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">清空已保存的 Key</div>
          <select v-model="deepseekClearApiKey">
            <option :value="false">不清空</option>
            <option :value="true">清空</option>
          </select>
          <div class="muted" style="margin-top: 6px">提示：清空后 DM 功能会因缺少 key 而不可用。</div>
        </div>
      </div>

      <div style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">OneBot Base URL（可选）</div>
        <input v-model="settings.onebotBaseUrl" placeholder="例如：http://127.0.0.1:3000" />
      </div>

      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button @click="saveSettings">保存设置</button>
      </div>
    </div>

    <div v-if="canLoad" class="card" style="margin-top: 12px">
      <div class="muted" style="margin-bottom: 8px">资源（Assets）</div>
      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">key</div>
          <input v-model="assetKey" placeholder="例如：item.sword_iron" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">url（可相对路径）</div>
          <input v-model="assetUrl" placeholder="例如：items/sword.png 或 https://..." />
        </div>
      </div>
      <div style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">mimeType（可选）</div>
        <input v-model="assetMime" placeholder="例如：image/png" />
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button :disabled="!assetKey.trim() || !assetUrl.trim()" @click="createAsset">创建资源</button>
        <button @click="loadAssets">刷新资源</button>
      </div>
      <div v-if="assets.length === 0" class="muted" style="margin-top: 10px">（暂无资源）</div>
      <div
        v-for="a in assets"
        :key="a.id"
        style="margin-top: 8px; padding: 10px; border: 1px solid #232a36; border-radius: 8px"
      >
        <div>key：{{ a.key }}</div>
        <div>url：{{ a.url }}</div>
        <div class="muted">mimeType：{{ a.mimeType || "-" }}</div>
        <div class="muted">updatedAt：{{ a.updatedAt }}</div>
        <div style="margin-top: 8px">
          <button @click="deleteAsset(a.key)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="canLoad" class="card" style="margin-top: 12px">
      <div class="muted" style="margin-bottom: 8px">道具/装备（Items）</div>
      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">类型</div>
          <select v-model="itemKind">
            <option value="ITEM">道具</option>
            <option value="EQUIPMENT">装备</option>
          </select>
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">名称</div>
          <input v-model="itemName" placeholder="例如：铁剑" />
        </div>
      </div>
      <div style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">描述（可选）</div>
        <input v-model="itemDesc" placeholder="例如：一把朴素的铁剑" />
      </div>
      <div style="margin-top: 12px">
        <div class="muted" style="margin-bottom: 6px">图片资源 key（可选）</div>
        <input v-model="itemImageKey" placeholder="例如：item.sword_iron（需要先创建 Asset）" />
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button :disabled="!itemName.trim()" @click="createItem">创建</button>
        <button @click="loadItems">刷新列表</button>
      </div>
      <div v-if="items.length === 0" class="muted" style="margin-top: 10px">（暂无道具）</div>
      <div
        v-for="it in items"
        :key="it.id"
        style="margin-top: 8px; padding: 10px; border: 1px solid #232a36; border-radius: 8px"
      >
        <div>{{ it.kind }}：{{ it.name }}</div>
        <div class="muted">{{ it.description || "-" }}</div>
        <div class="muted">imageAssetKey：{{ it.imageAsset?.key || "-" }}</div>
        <div class="muted">imageUrl：{{ it.imageUrl || "(未启用或未绑定)" }}</div>
        <div class="muted">updatedAt：{{ it.updatedAt }}</div>
        <div style="margin-top: 8px">
          <button @click="deleteItem(it.id)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="canLoad" class="card" style="margin-top: 12px">
      <div class="muted" style="margin-bottom: 8px">OneBot：群-房间绑定</div>

      <div class="row">
        <div>
          <div class="muted" style="margin-bottom: 6px">QQ群号（group_id）</div>
          <input v-model="bindGroupId" placeholder="例如：123456789" />
        </div>
        <div>
          <div class="muted" style="margin-bottom: 6px">房间 ID（roomId）</div>
          <input v-model="bindRoomId" placeholder="例如：cuid..." />
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px">
        <button :disabled="!bindGroupId.trim() || !bindRoomId.trim()" @click="upsertBinding">保存/更新绑定</button>
        <button @click="loadBindings">刷新列表</button>
      </div>

      <div class="muted" style="margin-top: 12px">当前绑定：</div>
      <div v-if="bindings.length === 0" class="muted" style="margin-top: 6px">（暂无绑定）</div>
      <div v-for="b in bindings" :key="b.id" style="margin-top: 8px; padding: 10px; border: 1px solid #232a36; border-radius: 8px">
        <div>groupId：{{ b.groupId }}</div>
        <div>roomId：{{ b.roomId }}</div>
        <div class="muted">createdAt：{{ b.createdAt }}</div>
        <div style="margin-top: 8px">
          <button @click="deleteBinding(b.groupId)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
