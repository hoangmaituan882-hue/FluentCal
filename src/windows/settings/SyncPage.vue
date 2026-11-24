<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';
import {
  confirm,
  FButton,
  FIcon,
  FInfoBar,
  FSelect,
  FSettingsCard,
  FSettingsExpander,
  FSettingsGroup,
  FSettingsRow,
  FTextBox,
} from '@/fluent';
import { call, isServer, type SyncProbe, type SyncStatus } from '@/api';
import { doc, patchSettings, taskList, useSetting } from '@/stores/doc';
import { syncNow, syncStatus, watchSync } from '@/composables/sync';
import { conflictCount } from '@/composables/syncConflicts';
import {
  fetchAccountProfile,
  logoutServer,
  serverState,
  syncWithServer,
  updateAccountProfile,
} from '@/serverApi';
import { statusLine, uploadedBy } from '@/lib/syncText';
import type { SyncProvider } from '@/types';
import SyncConflictPanel from './SyncConflictPanel.vue';

watchSync();
const nav = inject<(key: string) => void>('settingsNav');
const openPassPreview = inject<(() => void) | undefined>('openPassPreview', undefined);

const s = computed(() => doc.settings.sync);
const provider = useSetting<SyncProvider>('sync.provider');
const cloudProvider = computed(() => ['webdav', 'github', 'gitee'].includes(provider.value));
const locked = computed(() => s.value.enabled && cloudProvider.value);

const providers = [
  { value: '', label: '不同步' },
  { value: 'webdav', label: 'WebDAV（自建个人服务器 / 坚果云 / Nextcloud…）' },
  { value: 'github', label: 'GitHub 私有仓库' },
  { value: 'gitee', label: 'Gitee 私有仓库' },
  { value: 'folder', label: '同步盘文件夹（OneDrive、Google Drive…）' },
];

const davUrl = useSetting<string>('sync.webdav.url');
const davUser = useSetting<string>('sync.webdav.user');
const davFolder = useSetting<string>('sync.webdav.folder');
const interval = useSetting<number>('sync.interval');
const proxy = useSetting<string>('sync.proxy');
const gitKey = computed(() => (provider.value === 'gitee' ? 'gitee' : 'github'));
const gitField = (f: 'repo' | 'branch' | 'path') =>
  computed({
    get: () => s.value[gitKey.value][f],
    set: (v: string) => patchSettings({ sync: { [gitKey.value]: { [f]: v } } }),
  });
const repo = gitField('repo');
const branch = gitField('branch');
const path = gitField('path');

// ── Personal Cloud Account quick-login state (Desktop / Browser mode) ──
function stripDavSuffix(raw: string): string {
  return raw.trim().replace(/\/dav\/?$/i, '').replace(/\/+$/, '');
}

function normalizeServerDavUrl(raw: string): string {
  const clean = raw.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/\/dav$/i.test(clean)) return `${clean}/`;
  return `${clean}/dav/`;
}

const accountServer = ref(stripDavSuffix(davUrl.value || ''));
const accountUser = ref(davUser.value || 'fluentcal');
const accountPassword = ref('');
const showLegacyPanel = ref(
  !isServer && (provider.value === 'github' || provider.value === 'gitee' || provider.value === 'folder'),
);

watch(davUrl, (v) => {
  if (v && !accountServer.value) accountServer.value = stripDavSuffix(v);
});
watch(davUser, (v) => {
  if (v && !accountUser.value) accountUser.value = v;
});

// ── Server Mode Personal Profile & Password Management ──
const ACCENT_SWATCHES = ['#10A37F', '#0EA5E9', '#6366F1', '#F59E0B', '#E11D48', '#18181B'];
const profileDisplayName = ref('');
const profileTitle = ref('');
const profilePassNumber = ref('');
const profileColor = ref('#10A37F');
const profileSaving = ref(false);
const profileMsg = ref<{ sev: 'success' | 'error'; text: string } | null>(null);

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passSaving = ref(false);
const passMsg = ref<{ sev: 'success' | 'error'; text: string } | null>(null);
const copiedEndpoint = ref(false);

function hydrateProfileForm() {
  const a = serverState.account;
  if (!a) return;
  profileDisplayName.value = a.displayName || a.username || 'FluentCal';
  profileTitle.value = a.title || '个人多端工作台';
  profilePassNumber.value = a.passNumber || 'FC-01';
  profileColor.value = a.avatarColor || '#10A37F';
}

watch(() => serverState.account, hydrateProfileForm, { immediate: true });

async function saveProfile() {
  if (profileSaving.value) return;
  profileSaving.value = true;
  profileMsg.value = null;
  const res = await updateAccountProfile({
    displayName: profileDisplayName.value.trim(),
    title: profileTitle.value.trim(),
    passNumber: profilePassNumber.value.trim().toUpperCase(),
    avatarColor: profileColor.value,
  });
  profileSaving.value = false;
  profileMsg.value = res.ok
    ? { sev: 'success', text: '个人工牌资料已更新，下次进入登录页即刻生效。' }
    : { sev: 'error', text: res.error || '保存失败' };
}

async function changePassword() {
  if (passSaving.value) return;
  passMsg.value = null;
  if (!currentPassword.value || !newPassword.value) {
    passMsg.value = { sev: 'error', text: '请完整填写当前密码和新密码' };
    return;
  }
  if (newPassword.value.length < 4) {
    passMsg.value = { sev: 'error', text: '新密码至少需要 4 位字符' };
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    passMsg.value = { sev: 'error', text: '两次输入的新密码不一致' };
    return;
  }
  passSaving.value = true;
  const res = await updateAccountProfile({
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  });
  passSaving.value = false;
  if (res.ok) {
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    passMsg.value = { sev: 'success', text: '个人账号密码已更新（桌面与手机端请同步更新密码）。' };
  } else {
    passMsg.value = { sev: 'error', text: res.error || '修改密码失败' };
  }
}

const serverOrigin = computed(() => {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
});

async function copyEndpoint() {
  if (!serverOrigin.value) return;
  try {
    await navigator.clipboard.writeText(serverOrigin.value);
    copiedEndpoint.value = true;
    setTimeout(() => (copiedEndpoint.value = false), 1800);
  } catch {
    /* ignore */
  }
}

// ── Desktop Credential Vault & Sync Actions ──
const saved = ref<string[]>([]);
const secretInput = ref('');
const secretKey = computed(() => (provider.value === 'webdav' ? 'webdav' : gitKey.value));
const loadSecrets = async () => {
  if (isServer) return;
  saved.value = (await call<string[]>('sync_secrets')) ?? [];
};

async function saveSecret(key: string, value: string, silent = false) {
  if (!value.trim()) return true;
  try {
    await call('sync_set_secret', { key, value });
    await loadSecrets();
    if (!silent) say('success', '已保存到系统安全凭据管理器');
    return true;
  } catch (e) {
    say('error', String(e));
    return false;
  }
}

async function saveTyped() {
  await saveSecret(secretKey.value, secretInput.value);
  secretInput.value = '';
}

const secretHint = (key: string) => (saved.value.includes(key) ? '已安全保存（输入新值可替换）' : '');

const msg = ref<{ sev: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(null);
const say = (sev: 'success' | 'error' | 'info' | 'warning', text: string) => (msg.value = { sev, text });
const busy = ref(false);

function describe(p: SyncProbe): string {
  if (!p.exists) return `连接成功。云端还没有数据，开启后会上传本机的 ${taskList.value.length} 个任务。`;
  const by = uploadedBy(p.device, p.savedAt);
  return `连接成功。云端已有 ${p.tasks} 个任务、${p.groups} 个分组${by ? `，${by}` : ''}。`;
}

async function applyPersonalAccountFields(): Promise<boolean> {
  const url = normalizeServerDavUrl(accountServer.value);
  const user = accountUser.value.trim();
  if (!url) {
    say('error', '请填写你的个人 FluentCal 服务器地址（如 https://cal.example.com）');
    return false;
  }
  if (!user) {
    say('error', '请填写个人账号');
    return false;
  }
  patchSettings({
    sync: {
      provider: 'webdav',
      webdav: {
        url,
        user,
        folder: davFolder.value?.trim() || 'FluentCal',
      },
    },
  });
  if (accountPassword.value.trim()) {
    const ok = await saveSecret('webdav', accountPassword.value, true);
    if (!ok) return false;
    accountPassword.value = '';
  }
  return true;
}

async function probe(): Promise<SyncProbe | null> {
  busy.value = true;
  try {
    return await call<SyncProbe>('sync_probe');
  } catch (e) {
    say('error', `连接失败：${e}`);
    return null;
  } finally {
    busy.value = false;
  }
}

async function testPersonalAccount() {
  if (!(await applyPersonalAccountFields())) return;
  const p = await probe();
  if (p) say('success', describe(p));
}

async function signInPersonalAccount() {
  if (!(await applyPersonalAccountFields())) return;
  await enable();
}

async function test() {
  const p = await probe();
  if (p) say('success', describe(p));
}

async function enable() {
  const p = await probe();
  if (!p) return;
  let replace = false;
  if (p.exists && p.tasks > 0 && taskList.value.length > 0) {
    const by = uploadedBy(p.device, p.savedAt);
    const r = await confirm({
      title: '本机和云端都有数据',
      content: `云端：${p.tasks} 个任务${by ? `（${by}）` : ''}\n本机：${taskList.value.length} 个任务\n\n“合并”保留两边的任务，若同一项在双端同时修改，系统会自动记录并在冲突面板中供你选择。\n“用云端数据”会替换本机的任务（适合新设备首次登录）。\n两种方式都会先自动备份本机数据。`,
      primaryText: '智能合并',
      secondaryText: '用云端数据',
    });
    if (r === 'close') return;
    replace = r === 'secondary';
  }
  busy.value = true;
  try {
    const st = await call<SyncStatus>('sync_enable', { replace });
    if (st) Object.assign(syncStatus, st);
    say('success', replace ? '已登录云账号，本机数据已同步为云端版本。' : '已登录云账号并开启多端自动同步。');
  } catch (e) {
    say('error', `开启失败：${e}`);
  } finally {
    busy.value = false;
  }
}

async function disable() {
  await call('sync_disable');
  say('info', '已退出云端自动同步。本机数据完整保留，云端数据也不会被删除。');
}

async function handleSyncNow() {
  if (isServer) {
    await syncWithServer(true);
    await fetchAccountProfile();
  } else {
    await syncNow();
  }
}

async function handleSignOut() {
  if (isServer) {
    await logoutServer();
  } else {
    await disable();
  }
}

// ── Derived Hero Card Identity ──
const heroName = computed(() => {
  if (isServer) return serverState.account?.displayName || serverState.user || 'FluentCal';
  if (syncStatus.enabled && davUser.value) return davUser.value;
  return '个人本地空间';
});

const heroHandle = computed(() => {
  if (isServer) return `@${serverState.account?.username || serverState.user || 'fluentcal'}`;
  if (syncStatus.enabled && provider.value === 'webdav' && davUrl.value) {
    return `${davUser.value || 'owner'} · ${stripDavSuffix(davUrl.value).replace(/^https?:\/\//i, '')}`;
  }
  if (syncStatus.enabled) return `已接入 ${syncStatus.provider || provider.value}`;
  return '登录你的个人 FluentCal 云账号，在桌面、手机与网页间无感同步';
});

const heroInitials = computed(() => {
  const n = heroName.value.trim();
  if (!n || n === '个人本地空间') return 'FC';
  const parts = n.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
});

const heroPassNo = computed(() => serverState.account?.passNumber || 'FC-01');
const heroAccent = computed(() => serverState.account?.avatarColor || '#10A37F');
const isSignedIn = computed(() => (isServer ? serverState.authenticated : syncStatus.enabled));

const heroStatusTone = computed(() => {
  if (conflictCount.value > 0) return 'warn';
  if (syncStatus.error) return 'err';
  if (isSignedIn.value) return 'ok';
  return 'idle';
});

const heroStatusLabel = computed(() => {
  if (conflictCount.value > 0) return `${conflictCount.value} 处待处理冲突`;
  if (syncStatus.syncing) return '正在同步…';
  if (syncStatus.error) return syncStatus.halted ? '同步已暂停' : '同步异常';
  if (isSignedIn.value) return '多端同步已开启';
  return '仅本地存储';
});

function formatDeviceTime(ts: number | null | undefined): string {
  if (!ts) return '尚未同步';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '刚刚';
  }
}

const PROXIES = [
  { value: 'system', label: '使用系统代理' },
  { value: 'direct', label: '不使用代理' },
  { value: 'custom', label: '手动填写…' },
];
const proxyMode = computed({
  get: () => (proxy.value === '' ? 'system' : proxy.value === 'direct' ? 'direct' : 'custom'),
  set: (v: string) => (proxy.value = v === 'system' ? '' : v === 'direct' ? 'direct' : 'http://127.0.0.1:7890'),
});
const INTERVALS = [1, 5, 15, 30, 60]
  .map((m) => ({ value: m, label: `每 ${m} 分钟` }))
  .concat([{ value: 0, label: '只在启动和修改后' }]);
const open = (url: string) => void call('open_url', { url });

onMounted(() => {
  void loadSecrets();
  if (isServer && serverState.authenticated) {
    void fetchAccountProfile();
  }
});
</script>

<template>
  <div class="page acc-page">
    <!-- 1. Personal Pass Account Hero Card -->
    <section class="acc-hero" :style="{ '--acc-color': heroAccent }" aria-label="个人账号概览">
      <div class="acc-hero-slot" aria-hidden="true">
        <span class="acc-slot-pill" />
      </div>
      <div class="acc-hero-main">
        <div class="acc-id-block">
          <div class="acc-avatar">
            <span>{{ heroInitials }}</span>
          </div>
          <div class="acc-id-meta">
            <div class="acc-name-row">
              <h2 class="acc-name">{{ heroName }}</h2>
              <span class="acc-pass-no">PASS · {{ heroPassNo }}</span>
              <span class="acc-status-pill" :class="heroStatusTone">
                <span class="acc-status-dot" />
                {{ heroStatusLabel }}
              </span>
            </div>
            <p class="acc-handle">{{ heroHandle }}</p>
            <p class="acc-sync-line">{{ statusLine(syncStatus) }}</p>
          </div>
        </div>

        <div class="acc-hero-acts">
          <FButton
            v-if="isSignedIn"
            variant="accent"
            :disabled="syncStatus.syncing"
            @click="handleSyncNow"
          >
            {{ syncStatus.syncing ? '正在同步…' : '立即同步' }}
          </FButton>
          <FButton v-if="openPassPreview" variant="subtle" @click="openPassPreview">
            预览登录工牌
          </FButton>
          <FButton v-if="isSignedIn" variant="subtle" @click="handleSignOut">
            {{ isServer ? '退出登录' : '退出账号' }}
          </FButton>
        </div>
      </div>
    </section>

    <!-- 2. Real-Time Sync Conflict Center -->
    <FSettingsGroup title="同步冲突检测">
      <SyncConflictPanel />
    </FSettingsGroup>

    <!-- 3A. Standalone Server Mode: Personal Account Profile, Password & Connected Devices -->
    <template v-if="isServer">
      <FSettingsGroup title="个人工牌资料">
        <FSettingsCard title="工牌姓名" description="显示在首次进入网站的物理工牌与个人空间概览中">
          <FTextBox v-model="profileDisplayName" :width="280" placeholder="例如：Linze" label="工牌姓名" />
        </FSettingsCard>
        <FSettingsCard title="身份签名" description="工牌上的个人工作台副标题">
          <FTextBox v-model="profileTitle" :width="280" placeholder="个人多端加密工作台" label="身份签名" />
        </FSettingsCard>
        <FSettingsCard title="工牌编号" description="印刷在工牌右上角的个性化编号">
          <FTextBox v-model="profilePassNumber" :width="160" placeholder="FC-01" label="工牌编号" />
        </FSettingsCard>
        <FSettingsCard title="工牌主题强调色" description="用于工牌光带、NFC 环与身份徽章">
          <div class="acc-swatches">
            <button
              v-for="color in ACCENT_SWATCHES"
              :key="color"
              type="button"
              class="acc-swatch"
              :class="{ active: profileColor === color }"
              :style="{ '--swatch': color }"
              :aria-label="`选择颜色 ${color}`"
              @click="profileColor = color"
            />
          </div>
        </FSettingsCard>
        <div class="row-ctl actions">
          <FButton variant="accent" :disabled="profileSaving" @click="saveProfile">
            {{ profileSaving ? '正在保存…' : '保存工牌资料' }}
          </FButton>
        </div>
        <FInfoBar v-if="profileMsg" :severity="profileMsg.sev" closable @close="profileMsg = null">
          {{ profileMsg.text }}
        </FInfoBar>
      </FSettingsGroup>

      <FSettingsGroup title="账号安全">
        <FSettingsCard title="当前密码">
          <FTextBox v-model="currentPassword" type="password" :width="260" placeholder="输入当前访问密码" label="当前密码" />
        </FSettingsCard>
        <FSettingsCard title="新密码" description="采用加盐 scrypt 安全哈希存储在服务端，修改后立即生效">
          <FTextBox v-model="newPassword" type="password" :width="260" placeholder="至少 4 位字符" label="新密码" />
        </FSettingsCard>
        <FSettingsCard title="确认新密码">
          <FTextBox
            v-model="confirmPassword"
            type="password"
            :width="260"
            placeholder="再次输入新密码"
            label="确认新密码"
            @enter="changePassword"
          />
        </FSettingsCard>
        <div class="row-ctl actions">
          <FButton :disabled="passSaving" @click="changePassword">
            {{ passSaving ? '更新中…' : '修改访问密码' }}
          </FButton>
        </div>
        <FInfoBar v-if="passMsg" :severity="passMsg.sev" closable @close="passMsg = null">
          {{ passMsg.text }}
        </FInfoBar>
      </FSettingsGroup>

      <FSettingsGroup title="多端接入与已连接设备">
        <FSettingsCard
          icon="globe"
          title="桌面端与手机端接入地址"
          description="在 Windows 桌面版或 Android 手机版的「设置 → 账号与同步」填入下方地址与同一组个人账号密码即可互联"
        >
          <div class="row-ctl">
            <code class="acc-code-pill">{{ serverOrigin }}</code>
            <FButton size="small" variant="subtle" @click="copyEndpoint">
              {{ copiedEndpoint ? '已复制' : '复制地址' }}
            </FButton>
          </div>
        </FSettingsCard>

        <div v-if="serverState.account?.devices?.length" class="acc-device-grid">
          <div v-for="dev in serverState.account.devices" :key="dev.id" class="acc-device-card">
            <div class="acc-device-ico" aria-hidden="true">
              <FIcon :name="dev.platform === 'Windows' || dev.platform === 'macOS' ? 'desktop' : 'globe'" :size="15" />
            </div>
            <div class="acc-device-body">
              <div class="acc-device-name">{{ dev.name }}</div>
              <div class="acc-device-meta">
                <span>{{ dev.platform }}</span>
                <span>· 最近活跃 {{ formatDeviceTime(dev.lastSeenAt) }}</span>
                <span v-if="dev.lastSyncAt">· 同步 {{ formatDeviceTime(dev.lastSyncAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </FSettingsGroup>
    </template>

    <!-- 3B. Desktop / Browser Mode: Personal Cloud Account Quick Login + Collapsible Legacy Providers -->
    <template v-else>
      <FSettingsGroup title="个人 FluentCal 云账号">
        <div class="acc-login-box">
          <div class="acc-login-head">
            <div>
              <h3 class="acc-login-title">
                {{ syncStatus.enabled && provider === 'webdav' ? '已登录个人云端账号' : '登录个人云端账号' }}
              </h3>
              <p class="acc-login-sub">
                填写你自建的个人服务器地址、账号与密码即可自动打通网页版、Windows 桌面端与 Android 手机端。密码仅保存在系统凭据管理器中。
              </p>
            </div>
            <span v-if="saved.includes('webdav')" class="acc-vault-pill">
              <FIcon name="lock" :size="11" />
              已存凭据
            </span>
          </div>

          <div class="acc-form-grid">
            <label class="acc-field">
              <span>服务器地址</span>
              <FTextBox
                v-model="accountServer"
                type="url"
                :disabled="locked"
                placeholder="https://cal.example.com"
                label="服务器地址"
              />
            </label>
            <label class="acc-field">
              <span>个人账号</span>
              <FTextBox
                v-model="accountUser"
                :disabled="locked"
                placeholder="fluentcal"
                label="个人账号"
              />
            </label>
            <label class="acc-field">
              <span>访问密码</span>
              <FTextBox
                v-model="accountPassword"
                type="password"
                :placeholder="saved.includes('webdav') ? '••••••••（留空沿用已存密码）' : '输入个人密码'"
                label="访问密码"
                @enter="signInPersonalAccount"
              />
            </label>
          </div>

          <div class="acc-login-acts">
            <FButton :disabled="busy" @click="testPersonalAccount">测试连接</FButton>
            <FButton v-if="!syncStatus.enabled" variant="accent" :disabled="busy" @click="signInPersonalAccount">
              {{ busy ? '正在连接…' : '登录并开启多端同步' }}
            </FButton>
            <FButton v-else variant="subtle" :disabled="busy" @click="disable">
              切换账号 / 退出同步
            </FButton>
          </div>
        </div>

        <FInfoBar v-if="msg" :severity="msg.sev" closable @close="msg = null">{{ msg.text }}</FInfoBar>
        <FInfoBar
          v-else-if="syncStatus.enabled && syncStatus.error"
          :severity="syncStatus.halted ? 'error' : 'warning'"
          :title="syncStatus.halted ? '同步已暂停' : '同步失败'"
        >
          {{ syncStatus.error }}{{ syncStatus.halted ? '。修改配置或点“立即同步”后重试。' : '' }}
        </FInfoBar>
      </FSettingsGroup>

      <!-- Collapsible Legacy Providers & Advanced Settings -->
      <section class="acc-legacy-wrap">
        <button
          type="button"
          class="acc-legacy-toggle"
          :aria-expanded="showLegacyPanel"
          @click="showLegacyPanel = !showLegacyPanel"
        >
          <span class="acc-legacy-left">
            <FIcon :name="showLegacyPanel ? 'chevronDown' : 'chevronRight'" :size="12" />
            <span>其他同步方式与高级选项（坚果云 / GitHub / Gitee / 同步盘 / 代理）</span>
          </span>
          <span class="acc-legacy-badge">{{ provider || '未选' }}</span>
        </button>

        <div v-if="showLegacyPanel" class="acc-legacy-body">
          <FSettingsGroup title="自定义同步方式">
            <FSettingsCard
              icon="sync"
              title="同步通道"
              description="除了自建个人账号，也兼容坚果云 WebDAV、GitHub/Gitee 私有仓库与同步盘文件夹"
            >
              <FSelect v-model="provider" :options="providers" :width="290" :disabled="locked" label="同步方式" />
            </FSettingsCard>
            <FInfoBar v-if="locked" severity="info">同步已开启。要更换同步通道或地址，请先退出当前同步。</FInfoBar>
          </FSettingsGroup>

          <FSettingsGroup v-if="provider === 'webdav'" title="WebDAV 详细参数">
            <FSettingsCard title="WebDAV 地址" description="坚果云为 https://dav.jianguoyun.com/dav/">
              <div class="row-ctl">
                <FButton size="small" variant="subtle" :disabled="locked" @click="davUrl = 'https://dav.jianguoyun.com/dav/'">
                  坚果云
                </FButton>
                <FTextBox v-model="davUrl" :width="300" :disabled="locked" placeholder="https://" label="服务器地址" type="url" />
              </div>
            </FSettingsCard>
            <FSettingsCard title="用户名">
              <FTextBox v-model="davUser" :width="300" :disabled="locked" label="用户名" />
            </FSettingsCard>
            <FSettingsCard title="密码" :description="secretHint('webdav') || '坚果云请用“第三方应用密码”'">
              <FTextBox
                v-model="secretInput"
                type="password"
                :width="300"
                :placeholder="saved.includes('webdav') ? '••••••••' : ''"
                label="密码"
                @enter="saveTyped"
                @blur="saveTyped"
              />
            </FSettingsCard>
            <FSettingsCard title="文件夹" description="数据保存为 文件夹/fluentcal-data.json，不存在会自动创建">
              <FTextBox v-model="davFolder" :width="300" :disabled="locked" label="文件夹" />
            </FSettingsCard>
          </FSettingsGroup>

          <FSettingsGroup v-if="provider === 'github' || provider === 'gitee'" :title="provider === 'github' ? 'GitHub' : 'Gitee'">
            <FSettingsCard title="仓库" description="用户名/仓库名，必须是私有仓库">
              <FTextBox v-model="repo" :width="300" :disabled="locked" placeholder="name/fluentcal-data" label="仓库" />
            </FSettingsCard>
            <FSettingsCard
              title="Token"
              :description="secretHint(secretKey) || (provider === 'github' ? '需要这个仓库的 Contents 读写权限' : '需要 projects 权限')"
            >
              <FTextBox
                v-model="secretInput"
                type="password"
                :width="300"
                :placeholder="saved.includes(secretKey) ? '••••••••' : ''"
                label="Token"
                @enter="saveTyped"
                @blur="saveTyped"
              />
            </FSettingsCard>
            <FSettingsCard title="分支" description="留空使用默认分支">
              <FTextBox v-model="branch" :width="300" :disabled="locked" label="分支" />
            </FSettingsCard>
            <FSettingsCard title="文件路径" description="留空为 fluentcal-data.json">
              <FTextBox v-model="path" :width="300" :disabled="locked" label="文件路径" />
            </FSettingsCard>
          </FSettingsGroup>

          <FSettingsGroup v-if="provider === 'folder'" title="同步盘文件夹">
            <FSettingsCard
              icon="folder"
              title="把数据文件夹放到同步盘"
              description="在“数据”页把数据文件夹改到 OneDrive、Dropbox 或 Google Drive 桌面版的文件夹里，由它们负责同步。各电脑同时修改时按任务合并"
            >
              <FButton @click="nav?.('data')">去设置</FButton>
            </FSettingsCard>
          </FSettingsGroup>

          <template v-if="cloudProvider">
            <div class="row-ctl actions">
              <FButton :disabled="busy" @click="test">测试连接</FButton>
              <FButton v-if="!s.enabled" variant="accent" :disabled="busy" @click="enable">开启同步</FButton>
            </div>

            <FSettingsGroup title="帮助">
              <FSettingsExpander v-if="provider === 'webdav'" icon="help" title="怎样获取坚果云的 WebDAV 密码">
                <template #items>
                  <FSettingsRow title="坚果云网页版 › 右上角账户名 › 账户信息 › 安全选项 › 第三方应用管理 › 添加应用，生成的密码填到上面（不是登录密码）。用户名是坚果云的登录邮箱。" />
                </template>
              </FSettingsExpander>
              <FSettingsExpander v-if="provider === 'github'" icon="help" title="怎样创建 GitHub 仓库和 Token">
                <template #items>
                  <FSettingsRow title="1. 新建一个私有仓库（Private），例如 fluentcal-data" />
                  <FSettingsRow title="2. Settings › Developer settings › Fine-grained tokens › Generate new token：只选这个仓库，Repository permissions 里 Contents 选 Read and write">
                    <FButton size="small" variant="subtle" icon="link" @click="open('https://github.com/settings/personal-access-tokens/new')">打开</FButton>
                  </FSettingsRow>
                </template>
              </FSettingsExpander>
              <FSettingsExpander v-if="provider === 'gitee'" icon="help" title="怎样创建 Gitee 仓库和令牌">
                <template #items>
                  <FSettingsRow title="1. 新建一个私有仓库" />
                  <FSettingsRow title="2. 设置 › 私人令牌 › 生成新令牌，勾选 projects">
                    <FButton size="small" variant="subtle" icon="link" @click="open('https://gitee.com/profile/personal_access_tokens')">打开</FButton>
                  </FSettingsRow>
                </template>
              </FSettingsExpander>
            </FSettingsGroup>

            <FSettingsGroup title="高级同步策略">
              <FSettingsCard icon="clock" title="自动同步频率" description="本机修改后会自动上传；这里设置多久检查一次其他设备的修改">
                <FSelect v-model="interval" :options="INTERVALS" :width="200" label="自动同步" />
              </FSettingsCard>
              <FSettingsCard icon="globe" title="网络代理" description="局域网地址（家庭 NAS / 内网服务器）总是直连">
                <div class="row-ctl">
                  <FTextBox v-if="proxyMode === 'custom'" v-model="proxy" :width="200" placeholder="http://127.0.0.1:7890" label="代理地址" />
                  <FSelect v-model="proxyMode" :options="PROXIES" :width="160" label="网络代理" />
                </div>
              </FSettingsCard>
            </FSettingsGroup>
          </template>
        </div>
      </section>

      <p class="note">
        个人密码与访问令牌只保存在本机系统凭据管理器中，绝不会写入数据文件、备份或导出文件。开启同步与冲突恢复前均保留安全快照。
      </p>
    </template>
  </div>
</template>

<style scoped>
.acc-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── Personal Mini-Pass Account Hero ── */
.acc-hero {
  position: relative;
  border-radius: 18px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.08));
  background:
    radial-gradient(520px 200px at 0% 0%, color-mix(in srgb, var(--acc-color, #10a37f) 11%, transparent), transparent 68%),
    var(--card-fill, #ffffff);
  padding: 12px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.acc-hero-slot {
  display: flex;
  justify-content: center;
}

.acc-slot-pill {
  width: 44px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary, #18181b) 10%, transparent);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.14);
}

.acc-hero-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
}

.acc-id-block {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.acc-avatar {
  flex: none;
  width: 50px;
  height: 50px;
  border-radius: 15px;
  background: linear-gradient(
    145deg,
    var(--acc-color, #10a37f) 0%,
    color-mix(in srgb, var(--acc-color, #10a37f) 68%, #0ea5e9) 100%
  );
  color: #ffffff;
  display: grid;
  place-items: center;
  font-family: var(--font-display, inherit);
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.02em;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--acc-color, #10a37f) 28%, transparent);
}

.acc-id-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.acc-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.acc-name {
  margin: 0;
  font-family: var(--font-display, inherit);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary, var(--ws-ink));
}

.acc-pass-no {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.1));
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.acc-status-pill.ok {
  background: rgba(16, 163, 127, 0.13);
  color: #0d8c6d;
}

.acc-status-pill.warn {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.acc-status-pill.err {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

:global(html[data-ws-theme='dark']) .acc-status-pill.ok {
  color: #34d399;
}

:global(html[data-ws-theme='dark']) .acc-status-pill.warn {
  color: #fbbf24;
}

:global(html[data-ws-theme='dark']) .acc-status-pill.err {
  color: #f87171;
}

.acc-handle {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-secondary, var(--ws-ink-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
}

.acc-sync-line {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary, var(--ws-ink-muted));
}

.acc-hero-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── Desktop Personal Cloud Account Quick Login Card ── */
.acc-login-box {
  border-radius: 14px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.08));
  background: var(--card-fill, #ffffff);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.acc-login-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.acc-login-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary, var(--ws-ink));
}

.acc-login-sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-vault-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(16, 163, 127, 0.12);
  color: #0d8c6d;
}

:global(html[data-ws-theme='dark']) .acc-vault-pill {
  color: #34d399;
}

.acc-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}

.acc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-login-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── Profile Swatches & Connected Devices ── */
.acc-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}

.acc-swatch {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 2px solid transparent;
  background: var(--swatch);
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease;
}

.acc-swatch:hover {
  transform: scale(1.1);
}

.acc-swatch.active {
  box-shadow: 0 0 0 2px var(--card-fill, #ffffff), 0 0 0 4px var(--swatch);
}

.acc-code-pill {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.1));
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, var(--ws-ink));
}

.acc-device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.acc-device-card {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border-radius: 12px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.08));
  background: var(--card-fill, #ffffff);
}

.acc-device-ico {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-device-body {
  min-width: 0;
}

.acc-device-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, var(--ws-ink));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acc-device-meta {
  font-size: 11px;
  color: var(--text-tertiary, var(--ws-ink-muted));
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

/* ── Collapsible Legacy Providers ── */
.acc-legacy-wrap {
  border-radius: 14px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.08));
  background: var(--card-fill, #ffffff);
  overflow: hidden;
}

.acc-legacy-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 13px 15px;
  border: 0;
  background: transparent;
  color: var(--text-primary, var(--ws-ink));
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;
}

.acc-legacy-toggle:hover {
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.03));
}

.acc-legacy-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.acc-legacy-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.acc-legacy-body {
  padding: 4px 15px 16px;
  border-top: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.06));
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
