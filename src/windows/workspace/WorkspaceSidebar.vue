<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { syncNow, syncStatus, watchSync } from '@/composables/sync';
import { statusLine } from '@/lib/syncText';
import { effectiveStatus } from '@/lib/taskMeta';
import { makeGroup, saveGroup } from '@/lib/tasks';
import { doc, groupList, taskList } from '@/stores/doc';
import { classifyTaskBucket, relativeTimeLabel, type WorkspacePageKind } from './workspaceModel';

watchSync();

const props = defineProps<{
  open: boolean;
  activeKind: WorkspacePageKind;
  activeGroupId?: string;
  inboxCount: number;
  openCount: number;
}>();

const emit = defineEmits<{
  toggle: [];
  navigate: [kind: WorkspacePageKind, groupId?: string];
  newTask: [];
  openTask: [taskId: string];
  summonDesk: [];
  openSettings: [];
}>();

const areasExpanded = ref(true);
const recentExpanded = ref(true);
const addingGroup = ref(false);
const newGroupName = ref('');
const groupInputRef = ref<HTMLInputElement>();

const navItems = computed(() => [
  { kind: 'daily' as const, label: '今日聚焦', icon: 'today', count: 0 },
  { kind: 'calendar' as const, label: '日历视图', icon: 'calendar', count: 0 },
  { kind: 'inbox' as const, label: '收集箱', icon: 'flag', count: props.inboxCount },
  { kind: 'tasks' as const, label: '待办清单', icon: 'checklist', count: props.openCount },
  { kind: 'gantt' as const, label: '项目甘特', icon: 'gantt', count: 0 },
]);

const groupOpenCounts = computed(() => {
  const map = new Map<string, number>();
  const todayIso = now.value;
  for (const t of taskList.value) {
    if (!t.groupId) continue;
    if (classifyTaskBucket(t, todayIso) === 'completed') continue;
    map.set(t.groupId, (map.get(t.groupId) ?? 0) + 1);
  }
  return map;
});

const recentTasks = computed(() => {
  const active = taskList.value.slice();
  active.sort((a, b) => {
    const aIp = effectiveStatus(a) === 'in_progress' ? 1 : 0;
    const bIp = effectiveStatus(b) === 'in_progress' ? 1 : 0;
    if (aIp !== bIp) return bIp - aIp;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
  return active.slice(0, 6);
});

function groupHex(colorKey: string | undefined): string {
  return taskColor(colorKey, isDark.value).bar;
}

function dotColor(taskId: string): string {
  const t = doc.tasks[taskId];
  if (!t) return '#8A857E';
  if (effectiveStatus(t) === 'in_progress') return '#D97706';
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  if (!t.color && !gColor) return '#9E9990';
  return taskColor(t.color || gColor, isDark.value).bar;
}

const GROUP_PALETTE = ['blue', 'teal', 'green', 'orange', 'purple', 'indigo', 'red', 'gray'];

async function startAddGroup() {
  addingGroup.value = true;
  newGroupName.value = '';
  await nextTick();
  groupInputRef.value?.focus();
}

async function submitNewGroup() {
  const name = newGroupName.value.trim();
  addingGroup.value = false;
  newGroupName.value = '';
  if (!name) return;
  const color = GROUP_PALETTE[groupList.value.length % GROUP_PALETTE.length];
  const g = makeGroup(name, color);
  await saveGroup(g);
  emit('navigate', 'area', g.id);
}
</script>

<template>
  <aside class="ws-sidebar" :class="{ closed: !open }" aria-label="工作台导航">
    <div class="ws-sidebar-inner">
      <div class="sb-header">
        <div class="sb-brand">
          <span class="sb-logo" aria-hidden="true">
            <svg viewBox="0 0 18 18" width="16" height="16">
              <rect x="2.2" y="2.2" width="13.6" height="13.6" rx="4" fill="currentColor" />
              <path d="M6 7h6M6 10.5h4" stroke="#FAF9F6" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </span>
          <span class="sb-brand-name">FluentCal</span>
        </div>
        <button
          type="button"
          class="ws-icon-circle"
          title="收起侧边栏 (Ctrl+B)"
          aria-label="收起侧边栏"
          @click="emit('toggle')"
        >
          <FIcon name="sidebar" :size="14" />
        </button>
      </div>

      <div class="sb-cta-wrap">
        <button type="button" class="ws-cta-btn sb-cta" @click="emit('newTask')">
          <FIcon name="add" :size="13" />
          <span>新建任务</span>
        </button>
      </div>

      <div class="sb-scroll">
        <nav class="sb-nav" aria-label="主要视图">
          <button
            v-for="item in navItems"
            :key="item.kind"
            type="button"
            class="sb-nav-item"
            :class="{ active: activeKind === item.kind }"
            @click="emit('navigate', item.kind)"
          >
            <FIcon class="sb-nav-icon" :name="item.icon" :size="14" />
            <span class="sb-nav-label">{{ item.label }}</span>
            <span v-if="item.count > 0" class="sb-badge">{{ item.count }}</span>
          </button>
        </nav>

        <section class="sb-section">
          <div class="sb-sec-head">
            <button
              type="button"
              class="sb-sec-toggle"
              :aria-expanded="areasExpanded"
              @click="areasExpanded = !areasExpanded"
            >
              <FIcon class="sb-chev" :class="{ open: areasExpanded }" name="chevronRight" :size="10" />
              <span>分组</span>
            </button>
            <button
              type="button"
              class="sb-sec-add"
              title="新建分组"
              aria-label="新建分组"
              @click="startAddGroup"
            >
              <FIcon name="add" :size="11" />
            </button>
          </div>
          <div class="sb-accordion" :class="{ open: areasExpanded }">
            <div class="sb-accordion-body">
              <div v-if="addingGroup" class="sb-group-form">
                <input
                  ref="groupInputRef"
                  v-model="newGroupName"
                  type="text"
                  class="sb-group-input"
                  placeholder="输入分组名称…"
                  @keydown.enter.prevent="submitNewGroup"
                  @keydown.esc.stop="addingGroup = false"
                  @blur="submitNewGroup"
                />
              </div>
              <button
                v-for="g in groupList"
                :key="g.id"
                type="button"
                class="sb-nav-item sub"
                :class="{ active: activeKind === 'area' && activeGroupId === g.id }"
                @click="emit('navigate', 'area', g.id)"
              >
                <span class="sb-dot" :style="{ background: groupHex(g.color) }" />
                <span class="sb-nav-label">{{ g.name }}</span>
                <span v-if="groupOpenCounts.get(g.id)" class="sb-badge muted">{{ groupOpenCounts.get(g.id) }}</span>
              </button>
              <div v-if="!groupList.length && !addingGroup" class="sb-empty">暂无分组，点击右上 + 新建</div>
            </div>
          </div>
        </section>

        <section class="sb-section">
          <div class="sb-sec-head">
            <button
              type="button"
              class="sb-sec-toggle"
              :aria-expanded="recentExpanded"
              @click="recentExpanded = !recentExpanded"
            >
              <FIcon class="sb-chev" :class="{ open: recentExpanded }" name="chevronRight" :size="10" />
              <span>近期动态</span>
            </button>
          </div>
          <div class="sb-accordion" :class="{ open: recentExpanded }">
            <div class="sb-accordion-body">
              <button
                v-for="t in recentTasks"
                :key="t.id"
                type="button"
                class="sb-nav-item sub recent"
                @click="emit('openTask', t.id)"
              >
                <span class="sb-dot small" :style="{ background: dotColor(t.id) }" />
                <span class="sb-nav-label" :class="{ done: t.done }">{{ t.title }}</span>
                <span class="sb-rel-time">{{ relativeTimeLabel(t.updatedAt || t.createdAt, Date.now()) }}</span>
              </button>
              <div v-if="!recentTasks.length" class="sb-empty">暂无任务记录</div>
            </div>
          </div>
        </section>
      </div>

      <footer class="sb-footer">
        <button
          type="button"
          class="sb-foot-btn"
          :class="{ active: activeKind === 'settings' }"
          @click="emit('openSettings')"
        >
          <FIcon name="settings" :size="13" />
          <span>设置</span>
        </button>
        <div class="sb-foot-actions">
          <button
            v-if="syncStatus.enabled"
            type="button"
            class="ws-icon-circle"
            :class="{ spinning: syncStatus.syncing }"
            :title="`${statusLine(syncStatus)}（点击立即同步）`"
            @click="syncNow()"
          >
            <FIcon :name="syncStatus.error ? 'warning' : 'sync'" :size="13" />
          </button>
          <button
            type="button"
            class="ws-icon-circle"
            title="呼出桌面贴片日历"
            aria-label="呼出桌面贴片日历"
            @click="emit('summonDesk')"
          >
            <FIcon name="pin" :size="13" />
          </button>
        </div>
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.ws-sidebar {
  width: 236px;
  flex: none;
  background: var(--ws-sidebar-bg);
  border-right: 1px solid var(--ws-hairline);
  overflow: hidden;
  transition: width 240ms var(--ws-ease-out), border-color 180ms ease;
}

.ws-sidebar.closed {
  width: 0;
  border-right-color: transparent;
}

.ws-sidebar-inner {
  width: 236px;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 10px 10px;
  box-sizing: border-box;
  transition: opacity 180ms ease, transform 240ms var(--ws-ease-out);
}

.ws-sidebar.closed .ws-sidebar-inner {
  opacity: 0;
  transform: translateX(-14px);
  pointer-events: none;
}

.sb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 10px;
}

.sb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 4px;
}

.sb-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ws-ink);
}

.sb-brand-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
}

.sb-cta-wrap {
  padding: 0 2px 12px;
}

.sb-cta {
  width: 100%;
  height: 36px;
  border-radius: 12px;
  font-size: 13px;
}

.sb-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.sb-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-nav-item {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: flex;
  align-items: center;
  gap: 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease, transform 120ms var(--ws-ease-out);
}

.sb-nav-item:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.sb-nav-item:active {
  transform: scale(0.985);
}

.sb-nav-item.active {
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
}

.sb-nav-icon {
  flex: none;
  opacity: 0.78;
}

.sb-nav-item.active .sb-nav-icon {
  opacity: 1;
}

.sb-nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-nav-label.done {
  text-decoration: line-through;
  opacity: 0.52;
}

.sb-badge {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ws-ink-secondary);
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(28, 25, 23, 0.055);
}

.sb-badge.muted {
  background: transparent;
  padding: 0 2px;
  color: var(--ws-ink-muted);
  font-weight: 500;
}

.sb-section {
  margin-top: 14px;
}

.sb-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 4px;
}

.sb-sec-toggle {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-muted);
  cursor: pointer;
  transition: color 130ms ease;
}

.sb-sec-toggle:hover {
  color: var(--ws-ink-secondary);
}

.sb-chev {
  transition: transform 200ms var(--ws-ease-out);
}

.sb-chev.open {
  transform: rotate(90deg);
}

.sb-sec-add {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.sb-sec-add:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.sb-accordion {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 220ms var(--ws-ease-out), opacity 180ms ease;
  opacity: 0;
}

.sb-accordion.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.sb-accordion-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.sb-dot.small {
  width: 6px;
  height: 6px;
}

.sb-nav-item.recent {
  height: 29px;
  font-size: 12.5px;
}

.sb-rel-time {
  flex: none;
  font-size: 11px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.sb-group-form {
  padding: 2px 6px 4px;
}

.sb-group-input {
  width: 100%;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-size: 12.5px;
  box-sizing: border-box;
}

.sb-empty {
  padding: 6px 10px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.sb-footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  margin-top: 6px;
  border-top: 1px solid var(--ws-hairline);
}

.sb-foot-btn {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.sb-foot-btn:hover,
.sb-foot-btn.active {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.sb-foot-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.spinning :deep(.f-icon) {
  animation: ws-spin 1s linear infinite;
}

@keyframes ws-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
