<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { confirm, FIcon, showMenu, type MenuItem } from '@/fluent';
import type { Group, Task } from '@/types';
import { isServer, isTauri } from '@/api';
import { now } from '@/composables/now';
import { syncNow, syncStatus, watchSync } from '@/composables/sync';
import { statusLine } from '@/lib/syncText';
import { effectiveWorkspaceStatus } from '@/lib/taskMeta';
import { deleteGroup, makeGroup, saveGroup, saveTask } from '@/lib/tasks';
import { groupList, put, taskList } from '@/stores/doc';
import { notify } from '../desk/state';
import GroupSquircle from './GroupSquircle.vue';
import StatusGlyph from './StatusGlyph.vue';
import { classifyTaskBucket, type WorkspacePageKind } from './workspaceModel';
import { buildGroupCustomizeChildren, openTaskContextMenu } from './workspaceMenus';

watchSync();

type AreaSubTab = 'overview' | 'tasks' | 'calendar' | 'resources';

const props = defineProps<{
  open: boolean;
  activeKind: WorkspacePageKind;
  activeGroupId?: string;
  areaSubTab: AreaSubTab;
  inboxCount: number;
  openCount: number;
  countdownCount: number;
  wsTheme: 'light' | 'dark';
}>();

const emit = defineEmits<{
  close: [];
  navigate: [kind: WorkspacePageKind, groupId?: string];
  openAreaSub: [groupId: string, sub: AreaSubTab];
  newTask: [groupId?: string];
  quickSearch: [];
  openTask: [taskId: string];
  openSettings: [];
  toggleTheme: [];
  summonDesk: [];
  logout: [];
}>();

const starredExpanded = ref(true);
const groupsExpanded = ref(true);
const expandedGroups = ref<Record<string, boolean>>({});
const addingGroup = ref(false);
const newGroupName = ref('');
const groupInputRef = ref<HTMLInputElement>();

const renamingGroupId = ref<string | null>(null);
const renameDraft = ref('');
let renameInputEl: HTMLInputElement | null = null;

watch(
  () => props.activeGroupId,
  (gid) => {
    if (gid) expandedGroups.value[gid] = true;
  },
  { immediate: true },
);

const navItems = computed(() => [
  { kind: 'daily' as const, label: '今日聚焦', icon: 'today', count: 0 },
  { kind: 'calendar' as const, label: '日历视图', icon: 'calendar', count: 0 },
  { kind: 'inbox' as const, label: '收集箱', icon: 'flag', count: props.inboxCount },
  { kind: 'tasks' as const, label: '全部待办', icon: 'checklist', count: props.openCount },
  { kind: 'countdowns' as const, label: '倒数日', icon: 'timer', count: props.countdownCount },
  { kind: 'gantt' as const, label: '项目甘特', icon: 'gantt', count: 0 },
]);

const starredTasks = computed(() =>
  taskList.value
    .filter((t) => !t.countdownOnly && !!t.starred)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
);

const groupOpenCounts = computed(() => {
  const map = new Map<string, number>();
  const todayIso = now.value;
  for (const t of taskList.value) {
    if (t.countdownOnly || !t.groupId) continue;
    if (classifyTaskBucket(t, todayIso) === 'completed') continue;
    map.set(t.groupId, (map.get(t.groupId) ?? 0) + 1);
  }
  return map;
});

function isGroupExpanded(gid: string): boolean {
  if (expandedGroups.value[gid] !== undefined) return expandedGroups.value[gid];
  return props.activeGroupId === gid;
}

function chooseNav(kind: WorkspacePageKind) {
  emit('navigate', kind);
  emit('close');
}

function chooseAreaSub(gid: string, sub: AreaSubTab) {
  expandedGroups.value[gid] = true;
  emit('openAreaSub', gid, sub);
  emit('close');
}

function toggleGroupExpand(g: Group) {
  const next = !isGroupExpanded(g.id);
  expandedGroups.value[g.id] = next;
  if (next && !(props.activeKind === 'area' && props.activeGroupId === g.id)) {
    emit('openAreaSub', g.id, 'tasks');
  }
}

function openQuickSearchFromDrawer() {
  emit('close');
  emit('quickSearch');
}

function openSettingsFromDrawer() {
  emit('close');
  emit('openSettings');
}

function openStarredTask(t: Task) {
  emit('openTask', t.id);
  emit('close');
}

function openStarMenu(t: Task, e: MouseEvent) {
  void openTaskContextMenu(t, e.currentTarget as HTMLElement, { onOpen: () => openStarredTask(t) });
}

function unstarTask(t: Task) {
  void saveTask({ ...t, starred: undefined });
}

const GROUP_PALETTE = ['blue', 'teal', 'green', 'orange', 'purple', 'indigo', 'red', 'gray'];

async function startAddGroup() {
  groupsExpanded.value = true;
  addingGroup.value = true;
  newGroupName.value = '';
  await nextTick();
  groupInputRef.value?.focus();
}

async function submitNewGroup() {
  if (!addingGroup.value) return;
  const name = newGroupName.value.trim();
  addingGroup.value = false;
  newGroupName.value = '';
  if (!name) return;
  const color = GROUP_PALETTE[groupList.value.length % GROUP_PALETTE.length];
  const g = makeGroup(name, color);
  await saveGroup(g);
  expandedGroups.value[g.id] = true;
  chooseAreaSub(g.id, 'tasks');
}

function cancelNewGroup() {
  addingGroup.value = false;
  newGroupName.value = '';
}

function setRenameInput(el: unknown) {
  renameInputEl = el instanceof HTMLInputElement ? el : null;
}

async function startRenameGroup(g: Group) {
  renamingGroupId.value = g.id;
  renameDraft.value = g.name;
  await nextTick();
  renameInputEl?.focus();
  renameInputEl?.select();
}

async function commitRenameGroup(g: Group) {
  if (renamingGroupId.value !== g.id) return;
  const nextName = renameDraft.value.trim();
  renamingGroupId.value = null;
  if (nextName && nextName !== g.name) {
    await saveGroup({ ...g, name: nextName });
  }
}

function cancelRenameGroup() {
  renamingGroupId.value = null;
}

function moveGroup(g: Group, dir: -1 | 1) {
  const list = groupList.value;
  const idx = list.findIndex((x) => x.id === g.id);
  const other = list[idx + dir];
  if (!other) return;
  const nextOrder = other.order === g.order ? g.order + dir : other.order;
  void put('groups', {
    [g.id]: { ...g, order: nextOrder },
    [other.id]: { ...other, order: g.order },
  });
}

async function handleDeleteGroup(g: Group) {
  const res = await confirm({
    title: `删除分组“${g.name}”？`,
    content: '该分组下的任务不会被删除，将自动归为“未分组”。',
    primaryText: '删除分组',
    danger: true,
  });
  if (res !== 'primary') return;
  await deleteGroup(g.id);
  notify(`已删除分组“${g.name}”`, true);
}

function openGroupTouchMenu(g: Group, e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const list = groupList.value;
  const idx = list.findIndex((x) => x.id === g.id);
  const { iconItems, colorItems } = buildGroupCustomizeChildren(g);
  const items: MenuItem[] = [
    { key: 'open', label: '打开分组空间', action: () => chooseAreaSub(g.id, 'tasks') },
    {
      key: 'new-task',
      label: '新建任务到此分组',
      icon: 'add',
      action: () => {
        emit('close');
        emit('newTask', g.id);
      },
    },
    { key: 'rename', label: '重命名', action: () => void startRenameGroup(g) },
    { separator: true },
    {
      key: 'divider',
      label: g.dividerAfter ? '移除分隔线' : '添加分隔线',
      action: () => void saveGroup({ ...g, dividerAfter: !g.dividerAfter || undefined }),
    },
    { key: 'icon-sub', label: '分组图标…', children: iconItems },
    { key: 'color-sub', label: '分组颜色…', children: colorItems },
    { key: 'up', label: '上移一层', disabled: idx <= 0, action: () => moveGroup(g, -1) },
    { key: 'down', label: '下移一层', disabled: idx === -1 || idx >= list.length - 1, action: () => moveGroup(g, 1) },
    { separator: true },
    { key: 'delete', label: '删除分组', danger: true, action: () => void handleDeleteGroup(g) },
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function onDrawerKey(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    if (document.querySelector('[data-f-popup], .f-flyout, [role="menu"], .f-dlg-overlay')) return;
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onDrawerKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onDrawerKey, true));
</script>

<template>
  <Transition name="wmd-drawer">
    <div v-if="open" class="wmd-overlay" role="dialog" aria-modal="true" aria-label="导航抽屉" @click.self="emit('close')">
      <aside class="wmd-sheet">
        <header class="wmd-head">
          <div class="wmd-brand">
            <GroupSquircle name="FC" color-key="gray" :size="24" />
            <span class="wmd-brand-title">FluentCal</span>
            <span v-if="isServer" class="wmd-badge">云端工作台</span>
          </div>
          <button type="button" class="wmd-close-btn" title="关闭导航" aria-label="关闭导航" @click="emit('close')">
            <FIcon name="close" :size="14" />
          </button>
        </header>

        <div class="wmd-search-wrap">
          <button type="button" class="wmd-search-trigger" @click="openQuickSearchFromDrawer">
            <FIcon name="search" :size="14" class="wmd-search-ico" />
            <span>搜索任务、分组或跳转视图…</span>
          </button>
        </div>

        <div class="wmd-scroll">
          <section class="wmd-sec">
            <div class="wmd-nav-grid" role="navigation" aria-label="主要视图">
              <button
                v-for="item in navItems"
                :key="item.kind"
                type="button"
                class="wmd-nav-tile"
                :class="{ active: activeKind === item.kind }"
                @click="chooseNav(item.kind)"
              >
                <span class="wnt-top">
                  <FIcon :name="item.icon" :size="15" />
                  <span v-if="item.count > 0" class="wnt-cnt">{{ item.count }}</span>
                </span>
                <span class="wnt-lbl">{{ item.label }}</span>
              </button>
            </div>
          </section>

          <section class="wmd-sec">
            <div class="wmd-sec-head">
              <button
                type="button"
                class="wmd-sec-toggle"
                :aria-expanded="starredExpanded"
                @click="starredExpanded = !starredExpanded"
              >
                <span>星标置顶</span>
                <FIcon class="wmd-chev" :class="{ open: starredExpanded }" name="chevronDown" :size="10" />
              </button>
            </div>
            <div v-show="starredExpanded" class="wmd-star-list">
              <div
                v-for="t in starredTasks"
                :key="t.id"
                class="wmd-star-row"
                @click="openStarredTask(t)"
                @contextmenu.prevent="openStarMenu(t, $event)"
              >
                <StatusGlyph :status="effectiveWorkspaceStatus(t)" :size="15" />
                <span class="wmd-star-title">{{ t.title }}</span>
                <button
                  type="button"
                  class="wmd-row-act"
                  title="取消星标置顶"
                  aria-label="取消星标置顶"
                  @click.stop="unstarTask(t)"
                >
                  <FIcon name="close" :size="11" />
                </button>
              </div>
              <div v-if="!starredTasks.length" class="wmd-empty">在任务详情或右键中点击星标即可置顶</div>
            </div>
          </section>

          <section class="wmd-sec">
            <div class="wmd-sec-head">
              <button
                type="button"
                class="wmd-sec-toggle"
                :aria-expanded="groupsExpanded"
                @click="groupsExpanded = !groupsExpanded"
              >
                <span>分组空间</span>
                <FIcon class="wmd-chev" :class="{ open: groupsExpanded }" name="chevronDown" :size="10" />
              </button>
              <button type="button" class="wmd-add-grp" title="新建分组" aria-label="新建分组" @click="startAddGroup">
                <FIcon name="add" :size="13" />
              </button>
            </div>

            <div v-show="groupsExpanded" class="wmd-groups-tree">
              <div v-if="addingGroup" class="wmd-grp-form">
                <input
                  ref="groupInputRef"
                  v-model="newGroupName"
                  type="text"
                  class="wmd-grp-input"
                  placeholder="输入分组名称…"
                  @keydown.enter.prevent="submitNewGroup"
                  @keydown.esc.stop="cancelNewGroup"
                  @blur="submitNewGroup"
                />
              </div>

              <template v-for="g in groupList" :key="g.id">
                <div v-if="renamingGroupId === g.id" class="wmd-grp-form">
                  <input
                    :ref="setRenameInput"
                    v-model="renameDraft"
                    type="text"
                    class="wmd-grp-input"
                    @keydown.enter.prevent="commitRenameGroup(g)"
                    @keydown.esc.stop="cancelRenameGroup"
                    @blur="commitRenameGroup(g)"
                  />
                </div>
                <div v-else class="wmd-grp-node">
                  <div class="wmd-grp-row" :class="{ active: activeKind === 'area' && activeGroupId === g.id }">
                    <button type="button" class="wmd-grp-main" @click="toggleGroupExpand(g)">
                      <GroupSquircle :name="g.name" :color-key="g.color" :icon="g.icon" :size="20" />
                      <span class="wmd-grp-name">{{ g.name }}</span>
                      <span v-if="groupOpenCounts.get(g.id)" class="wmd-grp-cnt">{{ groupOpenCounts.get(g.id) }}</span>
                      <FIcon
                        class="wmd-g-chev"
                        :class="{ open: isGroupExpanded(g.id) }"
                        name="chevronDown"
                        :size="10"
                      />
                    </button>
                    <button
                      type="button"
                      class="wmd-row-act"
                      title="分组选项"
                      aria-label="分组选项"
                      @click="openGroupTouchMenu(g, $event)"
                    >
                      <FIcon name="more" :size="13" />
                    </button>
                  </div>

                  <div v-if="isGroupExpanded(g.id)" class="wmd-grp-subs">
                    <button
                      type="button"
                      class="wmd-sub-pill"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'tasks' }"
                      @click="chooseAreaSub(g.id, 'tasks')"
                    >
                      待办
                    </button>
                    <button
                      type="button"
                      class="wmd-sub-pill"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'overview' }"
                      @click="chooseAreaSub(g.id, 'overview')"
                    >
                      概览
                    </button>
                    <button
                      type="button"
                      class="wmd-sub-pill"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'calendar' }"
                      @click="chooseAreaSub(g.id, 'calendar')"
                    >
                      日历
                    </button>
                    <button
                      type="button"
                      class="wmd-sub-pill"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'resources' }"
                      @click="chooseAreaSub(g.id, 'resources')"
                    >
                      资料
                    </button>
                  </div>
                </div>

                <div v-if="g.dividerAfter" class="wmd-grp-divider" role="separator" />
              </template>

              <div v-if="!groupList.length && !addingGroup" class="wmd-empty">暂无分组，点击右上 + 新建</div>
            </div>
          </section>
        </div>

        <footer class="wmd-foot">
          <button type="button" class="wmd-util-btn" @click="emit('toggleTheme')">
            <FIcon :name="wsTheme === 'dark' ? 'sun' : 'moon'" :size="14" />
            <span>{{ wsTheme === 'dark' ? '浅色' : '深曜石' }}</span>
          </button>

          <button
            v-if="syncStatus.enabled"
            type="button"
            class="wmd-util-btn"
            :class="{ spinning: syncStatus.syncing }"
            :title="statusLine(syncStatus)"
            @click="syncNow()"
          >
            <FIcon :name="syncStatus.error ? 'warning' : 'sync'" :size="14" />
            <span>{{ syncStatus.syncing ? '同步中' : '同步' }}</span>
          </button>

          <button type="button" class="wmd-util-btn" @click="openSettingsFromDrawer">
            <FIcon name="settings" :size="14" />
            <span>设置</span>
          </button>

          <button v-if="isTauri" type="button" class="wmd-util-btn" @click="emit('summonDesk')">
            <FIcon name="pin" :size="14" />
            <span>桌面贴片</span>
          </button>

          <button v-if="isServer" type="button" class="wmd-util-btn danger" @click="emit('logout')">
            <FIcon name="power" :size="14" />
            <span>退出</span>
          </button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.wmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: var(--ws-scrim-bg);
  backdrop-filter: blur(6px);
  display: flex;
  justify-content: flex-start;
}

.wmd-sheet {
  width: min(316px, 84vw);
  height: 100dvh;
  max-height: 100dvh;
  background: var(--ws-sidebar-bg);
  color: var(--ws-ink);
  border-right: 1px solid var(--ws-hairline);
  border-radius: 0 22px 22px 0;
  box-shadow: var(--ws-shadow-float);
  padding:
    max(12px, env(safe-area-inset-top))
    12px
    max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wmd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wmd-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wmd-brand-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.wmd-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  color: var(--ws-ink-secondary);
}

.wmd-close-btn {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.wmd-search-wrap {
  flex: none;
}

.wmd-search-trigger {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-muted);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--ws-shadow-sm);
}

.wmd-search-ico {
  color: var(--ws-ink-secondary);
}

.wmd-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 2px;
}

.wmd-nav-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.wmd-nav-tile {
  padding: 10px 11px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease, box-shadow 140ms ease, transform 110ms var(--ws-ease-out);
}

.wmd-nav-tile:active {
  transform: scale(0.97);
}

.wmd-nav-tile.active {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline);
  color: var(--ws-ink);
  font-weight: 650;
  box-shadow: var(--ws-shadow-sm);
}

.wnt-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wnt-cnt {
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ws-pill-bg);
  color: var(--ws-ink-secondary);
}

.wnt-lbl {
  font-size: 13px;
}

.wmd-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wmd-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wmd-sec-toggle {
  border: 0;
  background: transparent;
  padding: 4px 2px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.wmd-chev,
.wmd-g-chev {
  color: var(--ws-ink-muted);
  transform: rotate(-90deg);
  transition: transform 160ms var(--ws-ease-out);
}

.wmd-chev.open,
.wmd-g-chev.open {
  transform: rotate(0deg);
}

.wmd-add-grp {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.wmd-star-list,
.wmd-groups-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wmd-star-row,
.wmd-grp-row {
  min-height: 40px;
  padding: 0 4px 0 10px;
  border-radius: 11px;
  background: var(--ws-stone-pill);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.wmd-grp-row {
  background: transparent;
  padding: 0 4px;
}

.wmd-grp-row.active {
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.wmd-grp-main {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.wmd-star-title,
.wmd-grp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wmd-star-title {
  font-size: 13px;
  font-weight: 500;
}

.wmd-grp-cnt {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.wmd-row-act {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}

.wmd-grp-node {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wmd-grp-subs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px 6px 4px 30px;
}

.wmd-sub-pill {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.wmd-sub-pill.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.wmd-grp-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--ws-hairline);
}

.wmd-grp-form {
  padding: 2px 0;
}

.wmd-grp-input {
  width: 100%;
  height: 36px;
  padding: 0 11px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-size: 13.5px;
  box-sizing: border-box;
  outline: none;
}

.wmd-empty {
  padding: 4px 6px;
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.wmd-foot {
  flex: none;
  padding-top: 8px;
  border-top: 1px solid var(--ws-hairline);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wmd-util-btn {
  flex: 1 1 auto;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}

.wmd-util-btn.danger {
  color: var(--ws-danger);
}

.wmd-util-btn.spinning :deep(.f-icon) {
  animation: wmd-spin 1s linear infinite;
}

@keyframes wmd-spin {
  to {
    transform: rotate(360deg);
  }
}

.wmd-drawer-enter-active {
  transition: opacity 240ms var(--ws-ease-out);
}

.wmd-drawer-leave-active {
  pointer-events: none;
  transition: opacity 160ms ease;
}

.wmd-drawer-enter-active .wmd-sheet {
  transition: transform 280ms var(--ws-ease-out);
}

.wmd-drawer-leave-active .wmd-sheet {
  transition: transform 170ms var(--ws-ease-out);
}

.wmd-drawer-enter-from,
.wmd-drawer-leave-to {
  opacity: 0;
}

.wmd-drawer-enter-from .wmd-sheet,
.wmd-drawer-leave-to .wmd-sheet {
  transform: translateX(-104%);
}
</style>
