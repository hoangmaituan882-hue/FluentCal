<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Capacitor } from "@capacitor/core";
import type { SyncProbe } from "@/api";
import { doc, flushSettings } from "@/stores/doc";
import { call } from "@/api";
import { readSyncBackup } from "@/mobile/backend";
import { disableSync, enableSync, probeSync, saveSyncConfig, syncNow, syncStatus, updateSecret } from "@/mobile/sync";
import { getSecret, setSecret } from "@/mobile/vault";
import type { SyncConfig } from "@/mobile/sync-remote";
import { connectPairCode, scanPairCode } from "@/mobile/pairing";
import { conflictCount } from "@/composables/syncConflicts";
import SyncConflictPanel from "../settings/SyncConflictPanel.vue";

const draft = ref<SyncConfig>(JSON.parse(JSON.stringify(doc.settings.sync)));
if (!["webdav", "github", "gitee"].includes(draft.value.provider)) draft.value.provider = "webdav";

function stripDavSuffix(raw: string): string {
  return raw.trim().replace(/\/dav\/?$/i, "").replace(/\/+$/, "");
}

function normalizeServerDavUrl(raw: string): string {
  const clean = raw.trim().replace(/\/+$/, "");
  if (!clean) return "";
  if (/\/dav$/i.test(clean)) return `${clean}/`;
  return `${clean}/dav/`;
}

const accountServer = ref(stripDavSuffix(draft.value.webdav.url || ""));
const accountUser = ref(draft.value.webdav.user || "fluentcal");
const accountPass = ref("");

const password = ref("");
const storedSecret = ref(false);
const busy = ref(false);
const error = ref("");
const message = ref("");
const probe = ref<SyncProbe>();
const expanded = ref(false);
const backup = ref(false);

const gitSettings = computed(() => (draft.value.provider === "gitee" ? draft.value.gitee : draft.value.github));

const statusText = computed(() =>
  conflictCount.value > 0
    ? `${conflictCount.value} 处待处理冲突`
    : syncStatus.syncing
      ? "正在同步…"
      : syncStatus.error
        ? syncStatus.halted
          ? "同步已暂停"
          : "等待自动重试"
        : !syncStatus.enabled
          ? "仅本机存储"
          : syncStatus.pending
            ? "本机有修改，等待上传"
            : "已同步",
);

const accountTitle = computed(() => {
  if (syncStatus.enabled && draft.value.provider === "webdav" && draft.value.webdav.user) {
    return draft.value.webdav.user;
  }
  if (syncStatus.enabled) return `云端账号 (${syncStatus.provider})`;
  return "个人本地空间";
});

const accountSub = computed(() => {
  if (syncStatus.enabled && draft.value.provider === "webdav" && draft.value.webdav.url) {
    return stripDavSuffix(draft.value.webdav.url).replace(/^https?:\/\//i, "");
  }
  if (syncStatus.enabled) return `上次成功 ${formatTime(syncStatus.lastSync)}`;
  return "登录你的个人 FluentCal 云账号，与电脑和网页实时互通";
});

const avatarInitials = computed(() => {
  const clean = accountTitle.value.trim();
  if (!clean || clean === "个人本地空间") return "FC";
  return clean.slice(0, 2).toUpperCase();
});

const formatTime = (at: number | null) => (at ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : "尚无记录");

watch(
  () => draft.value.provider,
  async (key) => {
    password.value = "";
    storedSecret.value = false;
    try {
      storedSecret.value = !!(await getSecret(key));
    } catch {
      /* Allow re-entering an invalidated credential. */
    }
  },
  { immediate: true },
);
watch(
  draft,
  () => {
    probe.value = undefined;
  },
  { deep: true },
);
watch([password, accountServer, accountUser, accountPass], () => {
  probe.value = undefined;
});
void readSyncBackup().then((value) => {
  backup.value = !!value;
});

async function action(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败，请重试";
  } finally {
    busy.value = false;
  }
}

async function testPersonalAccount() {
  await action(async () => {
    const url = normalizeServerDavUrl(accountServer.value);
    const user = accountUser.value.trim();
    if (!url) throw new Error("请填写个人服务器地址（例如 https://cal.example.com）");
    if (!user) throw new Error("请填写个人账号");
    draft.value.provider = "webdav";
    draft.value.webdav.url = url;
    draft.value.webdav.user = user;
    draft.value.webdav.folder = draft.value.webdav.folder?.trim() || "FluentCal";
    await flushSettings();
    await saveSyncConfig(draft.value, accountPass.value || undefined);
    accountPass.value = "";
    storedSecret.value = !!(await getSecret("webdav"));
    probe.value = await probeSync();
  });
}

async function test() {
  await action(async () => {
    await flushSettings();
    await saveSyncConfig(draft.value, password.value || undefined);
    password.value = "";
    storedSecret.value = !!(await getSecret(draft.value.provider));
    probe.value = await probeSync();
  });
}

function scan() {
  void action(async () => {
    const code = await scanPairCode();
    if (!code) return;
    const result = await connectPairCode(code);
    await saveSyncConfig(result.config, result.secret);
    draft.value = JSON.parse(JSON.stringify(result.config));
    accountServer.value = stripDavSuffix(draft.value.webdav.url || "");
    accountUser.value = draft.value.webdav.user || "fluentcal";
    password.value = "";
    accountPass.value = "";
    storedSecret.value = !!result.secret;
    probe.value = await probeSync();
    message.value = "已连接电脑「" + result.device + "」，账号配置已安全保存，请选择首次同步方式";
  });
}

function enable(mode: "merge" | "replace") {
  void action(async () => {
    try {
      await enableSync(mode);
    } finally {
      backup.value = !!(await readSyncBackup());
    }
    probe.value = undefined;
    expanded.value = false;
    message.value = "个人云账号自动同步已开启";
  });
}

function disable() {
  void action(async () => {
    await disableSync();
    draft.value = JSON.parse(JSON.stringify(doc.settings.sync));
    probe.value = undefined;
    message.value = "已退出云端自动同步，本机和云端数据均已保留";
  });
}

function renew() {
  void action(async () => {
    await updateSecret(password.value);
    password.value = "";
    storedSecret.value = true;
    await syncNow();
  });
}

function forgetSecret() {
  void action(async () => {
    await setSecret(draft.value.provider, "");
    storedSecret.value = false;
    password.value = "";
    accountPass.value = "";
    probe.value = undefined;
    message.value = "此手机保存的凭据已清除";
  });
}

function exportBackup() {
  void action(async () => {
    const content = await readSyncBackup();
    if (!content) throw new Error("暂无首次同步前备份");
    await call("file_save", { content, defaultName: "fluentcal-before-sync.json" });
    message.value = "备份已导出，可通过「导入备份」找回原有任务";
  });
}
</script>

<template>
  <div class="m-acc-wrap">
    <!-- 1. Personal Account Mini-Pass Card -->
    <section class="sync-card m-acc-hero" aria-label="个人账号与云同步">
      <div class="sync-heading">
        <div class="m-id-row">
          <div class="m-avatar">{{ avatarInitials }}</div>
          <div class="m-id-meta">
            <h3>{{ accountTitle }}</h3>
            <p>{{ accountSub }}</p>
          </div>
        </div>
        <span
          class="badge"
          :class="{
            warn: conflictCount > 0,
            good: conflictCount === 0 && syncStatus.enabled && !syncStatus.error,
            bad: conflictCount === 0 && syncStatus.halted,
          }"
        >
          {{ statusText }}
        </span>
      </div>

      <div class="sync-info" aria-live="polite">
        <p v-if="syncStatus.enabled">
          上次成功 {{ formatTime(syncStatus.lastSync) }}
          <span v-if="syncStatus.remoteDevice"> · 云端设备：{{ syncStatus.remoteDevice }}</span>
        </p>
        <p v-if="syncStatus.error" class="error" role="alert">{{ syncStatus.error }}</p>
      </div>

      <div v-if="syncStatus.enabled" class="buttons">
        <button class="primary" :disabled="busy || syncStatus.syncing" @click="action(() => syncNow())">
          {{ syncStatus.syncing ? "正在同步…" : "立即同步" }}
        </button>
        <button :disabled="busy" @click="expanded = !expanded">{{ expanded ? "收起配置" : "高级配置" }}</button>
        <button :disabled="busy || syncStatus.syncing" @click="disable">退出账号</button>
      </div>

      <!-- Not signed in: Personal Cloud Account Quick Sign-In + QR Pairing -->
      <div v-else class="m-signin">
        <form class="m-quick-form" @submit.prevent="testPersonalAccount">
          <label>
            个人服务器地址
            <input
              v-model="accountServer"
              type="url"
              placeholder="https://cal.example.com"
              autocapitalize="off"
              spellcheck="false"
              :disabled="busy"
            />
          </label>
          <div class="two-fields">
            <label>
              个人账号
              <input
                v-model="accountUser"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
                placeholder="fluentcal"
                :disabled="busy"
              />
            </label>
            <label>
              访问密码
              <input
                v-model="accountPass"
                type="password"
                autocomplete="current-password"
                :placeholder="storedSecret ? '留空沿用已存' : '输入密码'"
                :disabled="busy"
              />
            </label>
          </div>
          <div class="buttons">
            <button class="primary" type="submit" :disabled="busy">
              {{ busy ? "正在连接…" : "验证并登录云账号" }}
            </button>
            <button type="button" :disabled="busy" @click="scan">扫码连接电脑</button>
            <button type="button" :disabled="busy" @click="expanded = !expanded">
              {{ expanded ? "收起其他通道" : "其他通道" }}
            </button>
          </div>
        </form>
        <p class="hint">
          输入个人服务器地址与账号密码即可互联；也可扫描电脑端二维码一键导入。
        </p>
      </div>

      <!-- First Sync Probe Confirmation -->
      <div v-if="probe" class="first-sync" aria-label="首次同步选择">
        <h4>{{ probe.exists ? "发现个人云端数据" : "连接成功，云端暂无数据" }}</h4>
        <p v-if="probe.exists">
          {{ probe.tasks }} 个任务 · {{ probe.groups }} 个分组<br />
          {{ probe.device || "未知设备" }} · {{ formatTime(probe.savedAt) }}
        </p>
        <p>同步前会自动备份本机数据。选择「智能合并」会保留双端任务，并在双端同时修改时自动提示冲突对比。</p>
        <div class="buttons">
          <button class="primary" :disabled="busy" @click="enable('merge')">
            {{ probe.exists ? "智能合并并开启同步" : "上传本机并开启同步" }}
          </button>
          <button v-if="probe.exists" :disabled="busy" @click="enable('replace')">使用云端数据</button>
        </div>
      </div>

      <!-- Advanced / Legacy Providers Disclosure -->
      <form v-if="expanded" class="m-legacy-form" @submit.prevent="test">
        <fieldset :disabled="busy || syncStatus.enabled">
          <label>
            同步通道
            <select v-model="draft.provider" aria-label="同步服务">
              <option value="webdav">WebDAV（个人服务器 / 坚果云）</option>
              <option value="github">GitHub 私有仓库</option>
              <option value="gitee">Gitee 私有仓库</option>
            </select>
          </label>
          <template v-if="draft.provider === 'webdav'">
            <label>
              WebDAV 地址
              <input
                v-model="draft.webdav.url"
                aria-label="WebDAV 地址"
                type="url"
                placeholder="https://dav.example.com/dav"
                autocapitalize="off"
                spellcheck="false"
              />
            </label>
            <label>
              账号
              <input
                v-model="draft.webdav.user"
                aria-label="WebDAV 账号"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
              />
            </label>
            <label>
              云端文件夹
              <input
                v-model="draft.webdav.folder"
                aria-label="云端文件夹"
                placeholder="FluentCal"
                autocapitalize="off"
                spellcheck="false"
              />
            </label>
          </template>
          <template v-else>
            <label>
              私有仓库
              <input
                v-model="gitSettings.repo"
                aria-label="私有仓库"
                placeholder="owner/repo"
                autocapitalize="off"
                spellcheck="false"
              />
            </label>
            <div class="two-fields">
              <label>
                分支
                <input
                  v-model="gitSettings.branch"
                  aria-label="分支"
                  placeholder="默认分支"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </label>
              <label>
                文件路径
                <input
                  v-model="gitSettings.path"
                  aria-label="文件路径"
                  placeholder="fluentcal-data.json"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </label>
            </div>
          </template>
          <label>
            自动检查间隔
            <select v-model.number="draft.interval" aria-label="自动检查间隔">
              <option :value="1">1 分钟</option>
              <option :value="5">5 分钟</option>
              <option :value="15">15 分钟</option>
              <option :value="30">30 分钟</option>
              <option :value="60">60 分钟</option>
              <option :value="0">仅启动、恢复前台和修改后</option>
            </select>
          </label>
        </fieldset>
        <label>
          {{ draft.provider === "webdav" ? "密码 / 应用密码" : "访问令牌" }}
          <input
            v-model="password"
            :disabled="busy"
            :aria-label="draft.provider === 'webdav' ? '同步密码' : '访问令牌'"
            type="password"
            autocomplete="new-password"
            :placeholder="storedSecret ? '已安全保存，留空保留' : '填写后保存在此手机'"
          />
        </label>
        <p class="hint">
          {{ Capacitor.isNativePlatform() ? "凭据由 Android Keystore 加密，不进入备份或云端。" : "浏览器预览的凭据仅保存在当前页面内存中。" }}
        </p>
        <div class="buttons">
          <button v-if="!syncStatus.enabled" class="primary" type="submit" :disabled="busy">
            {{ busy ? "正在连接…" : "保存并测试连接" }}
          </button>
          <button v-else type="button" :disabled="busy || !password" @click="renew">更新凭据并重试</button>
          <button v-if="storedSecret && !syncStatus.enabled" type="button" :disabled="busy" @click="forgetSecret">
            清除已存凭据
          </button>
        </div>
      </form>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="message" class="message" role="status">{{ message }}</p>
      <button v-if="backup" class="backup" :disabled="busy" @click="exportBackup">导出首次同步前备份</button>
      <p class="hint footer">
        开启后，启动、恢复前台和联网时自动同步；多端同时离线编辑同一条目时，会自动在下方冲突区提示对比与保留选项。
      </p>
    </section>

    <!-- 2. Mobile Sync Conflict Visual Resolver -->
    <SyncConflictPanel compact />
  </div>
</template>

<style scoped>
.m-acc-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 12px 0;
}

.sync-card {
  padding: 16px;
  border: 1px solid var(--card-stroke);
  border-radius: 16px;
  background: var(--card-fill);
}

.m-acc-hero {
  background:
    radial-gradient(360px 150px at 0% 0%, color-mix(in srgb, #10a37f 10%, transparent), transparent 68%),
    var(--card-fill);
}

.sync-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.m-id-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.m-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(145deg, #10a37f, #0ea5e9);
  color: #ffffff;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 800;
}

.m-id-meta {
  min-width: 0;
}

h3 {
  font-size: 15.5px;
  margin: 0 0 2px;
}
h4 {
  margin: 0 0 8px;
}
p {
  margin: 5px 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.sync-heading p,
.sync-info {
  font-size: 12px;
  color: var(--text-secondary);
}

.badge {
  flex: none;
  max-width: 48%;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--subtle-fill-hover);
}
.badge.good {
  color: #0d8c6d;
  background: rgba(16, 163, 127, 0.14);
}
.badge.warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.18);
}
.badge.bad,
.error {
  color: var(--critical);
}

.m-signin {
  margin-top: 12px;
}

fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}

form {
  margin-top: 10px;
}

.m-legacy-form {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--card-stroke);
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  border: 1px solid var(--card-stroke);
  border-radius: 9px;
  padding: 8px 10px;
  background: var(--solid-base);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}

input:focus,
select:focus {
  outline: 2px solid #10a37f;
  outline-offset: 1px;
}

.two-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

button {
  border: 1px solid var(--card-stroke);
  background: var(--subtle-fill-hover);
  color: var(--text-primary);
  border-radius: 9px;
  padding: 9px 12px;
  min-height: 40px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

button.primary {
  background: #10a37f;
  color: #ffffff;
  border-color: transparent;
}

button:disabled,
input:disabled,
select:disabled {
  opacity: 0.6;
  cursor: default;
}

.hint {
  color: var(--text-secondary);
  font-size: 11px;
  margin: 8px 0 10px;
}

.footer {
  margin-bottom: 0;
  margin-top: 12px;
}

.first-sync {
  border: 1px solid var(--card-stroke);
  border-radius: 12px;
  padding: 13px;
  margin-top: 14px;
  background: color-mix(in srgb, #10a37f 6%, transparent);
  font-size: 12px;
}

.error,
.message {
  font-size: 12px;
  margin-top: 10px;
}

.message {
  color: #0d8c6d;
}

.backup {
  margin-top: 10px;
  font-size: 12px;
}
</style>
