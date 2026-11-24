<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { confirm, FIcon, place, showMenu, type MenuItem } from '@/fluent';
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
import NumberPop from './NumberPop.vue';
import StatusGlyph from './StatusGlyph.vue';
import { cancelTaskPreview, hideTaskPreview, showTaskPreview } from './useTaskHoverPreview';
import { classifyTaskBucket, type WorkspacePageKind } from './workspaceModel';
import { buildGroupCustomizeChildren, openTaskContextMenu } from './workspaceMenus';
import {
  armSpringNav,
  cancelSpringNav,
  dropTaskToDate,
  dropTaskToGroup,
  dropTaskToInbox,
  dropTaskToStarred,
  endTaskDrag,
  getDraggedTaskId,
  hasTaskDragPayload,
  SPRING_NAV_DELAY_MS,
  workspaceDrag,
} from './workspaceDrag';

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
  subscriptionDueCount?: number;
  wsTheme: 'light' | 'dark';
}>();

const emit = defineEmits<{
  toggle: [];
  navigate: [kind: WorkspacePageKind, groupId?: string];
  openAreaSub: [groupId: string, sub: AreaSubTab];
  newTask: [groupId?: string];
  quickSearch: [];
  openTask: [taskId: string];
  summonDesk: [];
  openSettings: [];
  toggleTheme: [];
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

const preview = ref<{ groupId: string; icon?: string; iconOverride?: boolean; color?: string } | null>(null);

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
  { kind: 'subscriptions' as const, label: '订阅日历', icon: 'subscription', count: props.subscriptionDueCount ?? 0 },
  { kind: 'countdowns' as const, label: '倒数日', icon: 'timer', count: props.countdownCount },
  { kind: 'gantt' as const, label: '项目甘特', icon: 'gantt', count: 0 },
]);

const starredTasks = computed(() =>
  taskList.value
    .filter((t) => !t.countdownOnly && !t.subscriptionOnly && !!t.starred)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
);

const groupOpenCounts = computed(() => {
  const map = new Map<string, number>();
  const todayIso = now.value;
  for (const t of taskList.value) {
    if (t.countdownOnly || t.subscriptionOnly || !t.groupId) continue;
    if (classifyTaskBucket(t, todayIso) === 'completed') continue;
    map.set(t.groupId, (map.get(t.groupId) ?? 0) + 1);
  }
  return map;
});

function isGroupExpanded(gid: string): boolean {
  if (expandedGroups.value[gid] !== undefined) return expandedGroups.value[gid];
  return props.activeGroupId === gid;
}

function toggleGroupTree(g: Group) {
  const next = !isGroupExpanded(g.id);
  expandedGroups.value[g.id] = next;
  if (next && !(props.activeKind === 'area' && props.activeGroupId === g.id)) {
    emit('openAreaSub', g.id, 'tasks');
  }
}

function displayGroupIcon(g: Group): string | undefined {
  if (preview.value?.groupId === g.id && preview.value.iconOverride) {
    return preview.value.icon;
  }
  return g.icon;
}

function displayGroupColorKey(g: Group): string {
  return preview.value?.groupId === g.id && preview.value.color ? preview.value.color : g.color;
}

function openWorkspaceMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '新建任务…', icon: 'add', shortcut: 'Ctrl+N', action: () => emit('newTask') },
    { label: '搜索与命令…', icon: 'search', shortcut: 'Ctrl+K', action: () => emit('quickSearch') },
    { separator: true },
    {
      label: props.wsTheme === 'dark' ? '切换浅色工作台' : '切换深曜石暗色',
      icon: props.wsTheme === 'dark' ? 'sun' : 'moon',
      action: () => emit('toggleTheme'),
    },
    ...(syncStatus.enabled ? [{ label: '立即同步', icon: 'sync', action: () => void syncNow() }] : []),
    ...(isTauri ? [{ label: '呼出桌面贴片日历', icon: 'pin', action: () => emit('summonDesk') }] : []),
    { separator: true },
    { label: '偏好设置…', icon: 'settings', shortcut: 'Ctrl+,', action: () => emit('openSettings') },
    ...(isServer ? [{ separator: true as const }, { label: '退出登录', icon: 'power', danger: true, action: () => emit('logout') }] : []),
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
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
  emit('openAreaSub', g.id, 'tasks');
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

function openGroupMenu(g: Group, e: MouseEvent) {
  const list = groupList.value;
  const idx = list.findIndex((x) => x.id === g.id);
  const resetPreview = () => {
    if (preview.value?.groupId === g.id) preview.value = null;
  };
  const { iconItems, colorItems } = buildGroupCustomizeChildren(g, {
    onPreviewIcon: (iconKey) => {
      preview.value = { groupId: g.id, icon: iconKey, iconOverride: true };
    },
    onPreviewColor: (colorKey) => {
      preview.value = { groupId: g.id, color: colorKey };
    },
    onResetPreview: resetPreview,
  });

  const items: MenuItem[] = [
    { key: 'open', label: '打开分组空间', onHover: resetPreview, action: () => emit('openAreaSub', g.id, 'tasks') },
    { key: 'new-task', label: '新建任务到此分组', onHover: resetPreview, action: () => emit('newTask', g.id) },
    {
      key: 'copy-name',
      label: '复制名称',
      onHover: resetPreview,
      action: () => {
        void navigator.clipboard?.writeText(g.name);
        notify(`已复制“${g.name}”`);
      },
    },
    { key: 'rename', label: '重命名', onHover: resetPreview, action: () => void startRenameGroup(g) },
    { separator: true },
    {
      key: 'divider',
      label: g.dividerAfter ? '移除分隔线' : '添加分隔线',
      onHover: resetPreview,
      action: () => void saveGroup({ ...g, dividerAfter: !g.dividerAfter || undefined }),
    },
    {
      key: 'icon-sub',
      label: '分组图标…',
      children: iconItems,
    },
    {
      key: 'color-sub',
      label: '分组颜色…',
      children: colorItems,
    },
    {
      key: 'up',
      label: '上移一层',
      disabled: idx <= 0,
      onHover: resetPreview,
      action: () => moveGroup(g, -1),
    },
    {
      key: 'down',
      label: '下移一层',
      disabled: idx === -1 || idx >= list.length - 1,
      onHover: resetPreview,
      action: () => moveGroup(g, 1),
    },
    { separator: true },
    {
      key: 'delete',
      label: '删除分组',
      danger: true,
      onHover: resetPreview,
      action: () => void handleDeleteGroup(g),
    },
  ];
  void showMenu(items, { x: e.clientX, y: e.clientY }, { placement: 'right-start', onClose: resetPreview });
}

function onStarHover(t: Task, e: PointerEvent) {
  showTaskPreview(t, e.currentTarget as HTMLElement);
}

function onStarClick(t: Task) {
  cancelTaskPreview();
  emit('openTask', t.id);
}

function openStarMenu(t: Task, e: MouseEvent) {
  cancelTaskPreview();
  void openTaskContextMenu(t, { x: e.clientX, y: e.clientY }, { onOpen: () => emit('openTask', t.id) });
}

function unstarTask(t: Task) {
  cancelTaskPreview();
  void saveTask({ ...t, starred: undefined });
}

const helpOpen = ref(false);
const helpBtnRef = ref<HTMLElement>();
const helpPopRef = ref<HTMLElement>();
const helpPos = ref({ left: 12, top: 200 });

async function toggleHelpPop() {
  if (helpOpen.value) {
    helpOpen.value = false;
    return;
  }
  helpOpen.value = true;
  await nextTick();
  const btn = helpBtnRef.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const popEl = helpPopRef.value;
  const w = popEl?.offsetWidth || 276;
  const h = popEl?.offsetHeight || 272;
  const p = place({ left: r.left, top: r.top, width: r.width, height: r.height }, w, h, 'top-start', 8);
  helpPos.value = { left: p.left, top: p.top };
}

function onHelpPointerDown(e: PointerEvent) {
  if (!helpOpen.value) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (helpPopRef.value?.contains(target) || helpBtnRef.value?.contains(target)) return;
  helpOpen.value = false;
}

function onHelpKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && helpOpen.value) {
    e.preventDefault();
    e.stopPropagation();
    helpOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onHelpPointerDown, true);
  window.addEventListener('keydown', onHelpKeyDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onHelpPointerDown, true);
  window.removeEventListener('keydown', onHelpKeyDown, true);
});

const SHORTCUT_TIPS: { keys: string; desc: string }[] = [
  { keys: '拖动侧栏边缘', desc: '自由调宽 / 左拉收起 / 双击还原' },
  { keys: 'Ctrl+K', desc: '全局搜索与跳转' },
  { keys: 'Ctrl+N', desc: '快速新建任务' },
  { keys: 'Ctrl+F', desc: '定位筛选输入框' },
  { keys: 'Ctrl+B', desc: '展开 / 收起侧栏' },
  { keys: 'Alt+←/→', desc: '历史页面前进与后退' },
  { keys: 'Shift+点击状态', desc: '一键标为已完成 / 恢复' },
  { keys: '拖拽任务行', desc: '在状态组间快捷流转' },
  { keys: '右键分组', desc: '更换图标、色彩与分隔线' },
];

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      helpOpen.value = false;
      cancelTaskPreview();
    }
  },
);

// Cross-View Drag & 450ms Spring-Loaded Navigation on Sidebar Pills & Groups
const dropNavKind = ref<string>('');
const dropStarred = ref(false);
const dropGroupId = ref<string>('');

function onNavDragOver(kind: WorkspacePageKind, e: DragEvent) {
  if (!hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dropNavKind.value = kind;
  if (props.activeKind !== kind) {
    armSpringNav(`nav:${kind}`, () => {
      emit('navigate', kind);
    });
  }
}

function onNavDragLeave(kind: WorkspacePageKind) {
  if (dropNavKind.value === kind) dropNavKind.value = '';
  cancelSpringNav(`nav:${kind}`);
}

function onNavDrop(kind: WorkspacePageKind, e: DragEvent) {
  dropNavKind.value = '';
  cancelSpringNav(`nav:${kind}`);
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  if (kind === 'daily') {
    void dropTaskToDate(taskId, now.value);
  } else if (kind === 'inbox') {
    void dropTaskToInbox(taskId);
  } else if (kind === 'calendar') {
    void dropTaskToDate(taskId, now.value);
    emit('navigate', 'calendar');
  } else {
    emit('navigate', kind);
    endTaskDrag();
  }
}

function onStarSecDragOver(e: DragEvent) {
  if (!hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dropStarred.value = true;
}

function onStarSecDrop(e: DragEvent) {
  dropStarred.value = false;
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  void dropTaskToStarred(taskId);
}

function onGroupDragOver(groupId: string, e: DragEvent) {
  if (!hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dropGroupId.value = groupId;
  if (!(props.activeKind === 'area' && props.activeGroupId === groupId)) {
    armSpringNav(`grp:${groupId}`, () => {
      emit('navigate', 'area', groupId);
    });
  }
}

function onGroupDragLeave(groupId: string) {
  if (dropGroupId.value === groupId) dropGroupId.value = '';
  cancelSpringNav(`grp:${groupId}`);
}

function onGroupDrop(groupId: string, e: DragEvent) {
  dropGroupId.value = '';
  cancelSpringNav(`grp:${groupId}`);
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  void dropTaskToGroup(taskId, groupId);
}
</script>

<template>
  <aside class="ws-sidebar" aria-label="工作台导航">
    <div class="ws-sidebar-inner">
      <!-- Tegon Top Workspace Header -->
      <div class="sb-header">
        <button type="button" class="sb-ws-btn" @click="openWorkspaceMenu">
          <GroupSquircle name="FC" color-key="gray" :size="20" />
          <span class="sb-brand-name">FluentCal</span>
          <FIcon name="chevronDown" :size="9" class="sb-brand-chev" />
        </button>

        <button
          type="button"
          class="sb-col-btn"
          title="收起侧边栏 (Ctrl+B)"
          aria-label="收起侧边栏"
          @click="emit('toggle')"
        >
          <FIcon name="sidebar" :size="14" />
        </button>
      </div>

      <div class="sb-scroll">
        <!-- Tactile Stone-Pill Primary Nav -->
        <nav class="sb-nav" aria-label="主要视图">
          <button
            v-for="item in navItems"
            :key="item.kind"
            type="button"
            class="stone-pill"
            :class="{
              active: activeKind === item.kind,
              'drop-over': dropNavKind === item.kind,
              'spring-charging': workspaceDrag.springKey === `nav:${item.kind}`,
            }"
            :style="{ '--spring-ms': `${SPRING_NAV_DELAY_MS}ms` }"
            @click="emit('navigate', item.kind)"
            @dragover="onNavDragOver(item.kind, $event)"
            @dragleave="onNavDragLeave(item.kind)"
            @drop="onNavDrop(item.kind, $event)"
          >
            <FIcon class="sp-ico" :name="item.icon" :size="15" :active="activeKind === item.kind" />
            <span class="sp-lbl">{{ item.label }}</span>
            <span v-if="item.count > 0" class="sp-cnt"><NumberPop :value="item.count" /></span>
          </button>
        </nav>

        <!-- Starred Pinned Tasks (with Hover Preview Card) -->
        <section
          class="sb-section"
          :class="{ 'drop-star-sec': dropStarred }"
          @dragover="onStarSecDragOver"
          @dragleave="dropStarred = false"
          @drop="onStarSecDrop"
        >
          <div class="sb-sec-head">
            <button
              type="button"
              class="sb-sec-toggle"
              :aria-expanded="starredExpanded"
              @click="starredExpanded = !starredExpanded"
            >
              <span>星标置顶</span>
              <FIcon class="sb-chev" :class="{ open: starredExpanded }" name="chevronDown" :size="9" />
            </button>
          </div>
          <div class="sb-accordion" :class="{ open: starredExpanded }">
            <div class="sb-accordion-body sb-star-list">
              <div
                v-for="t in starredTasks"
                :key="t.id"
                role="button"
                tabindex="0"
                class="star-pill"
                @pointerenter="onStarHover(t, $event)"
                @pointerleave="hideTaskPreview"
                @click="onStarClick(t)"
                @keydown.enter.space.prevent="onStarClick(t)"
                @contextmenu.prevent="openStarMenu(t, $event)"
              >
                <StatusGlyph :status="effectiveWorkspaceStatus(t)" :size="14" />
                <span class="star-title">{{ t.title }}</span>
                <button
                  type="button"
                  class="star-unpin"
                  title="取消星标置顶"
                  aria-label="取消星标置顶"
                  @pointerenter.stop
                  @click.stop="unstarTask(t)"
                >
                  <FIcon name="close" :size="9" />
                </button>
              </div>
              <div v-if="!starredTasks.length" class="sb-empty">右键任务即可加入星标</div>
            </div>
          </div>
        </section>

        <!-- Teams / Groups Expandable Tree + Dividers -->
        <section class="sb-section">
          <div class="sb-sec-head">
            <button
              type="button"
              class="sb-sec-toggle"
              :aria-expanded="groupsExpanded"
              @click="groupsExpanded = !groupsExpanded"
            >
              <span>分组空间</span>
              <FIcon class="sb-chev" :class="{ open: groupsExpanded }" name="chevronDown" :size="9" />
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

          <div class="sb-accordion" :class="{ open: groupsExpanded }">
            <div class="sb-accordion-body sb-groups-tree">
              <div v-if="addingGroup" class="sb-group-form">
                <input
                  ref="groupInputRef"
                  v-model="newGroupName"
                  type="text"
                  class="sb-group-input"
                  placeholder="输入分组名称…"
                  @keydown.enter.prevent="submitNewGroup"
                  @keydown.esc.stop="cancelNewGroup"
                  @blur="submitNewGroup"
                />
              </div>

              <template v-for="g in groupList" :key="g.id">
                <div v-if="renamingGroupId === g.id" class="sb-group-form">
                  <input
                    :ref="setRenameInput"
                    v-model="renameDraft"
                    type="text"
                    class="sb-group-input"
                    @keydown.enter.prevent="commitRenameGroup(g)"
                    @keydown.esc.stop="cancelRenameGroup"
                    @blur="commitRenameGroup(g)"
                  />
                </div>
                <div v-else class="sb-group-node">
                  <button
                    type="button"
                    class="sb-group-btn"
                    :class="{
                      active: activeKind === 'area' && activeGroupId === g.id,
                      'drop-over': dropGroupId === g.id,
                      'spring-charging': workspaceDrag.springKey === `grp:${g.id}`,
                    }"
                    :style="{ '--spring-ms': `${SPRING_NAV_DELAY_MS}ms` }"
                    @click="toggleGroupTree(g)"
                    @contextmenu.prevent="openGroupMenu(g, $event)"
                    @dragover="onGroupDragOver(g.id, $event)"
                    @dragleave="onGroupDragLeave(g.id)"
                    @drop="onGroupDrop(g.id, $event)"
                  >
                    <GroupSquircle
                      :name="g.name"
                      :color-key="displayGroupColorKey(g)"
                      :icon="displayGroupIcon(g)"
                      :size="18"
                    />
                    <span class="sb-group-name">{{ g.name }}</span>
                    <FIcon
                      class="sb-g-chev"
                      :class="{ open: isGroupExpanded(g.id) }"
                      name="chevronDown"
                      :size="9"
                    />
                  </button>

                  <div v-if="isGroupExpanded(g.id)" class="sb-group-subs">
                    <button
                      type="button"
                      class="stone-pill sub"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'tasks' }"
                      @click="emit('openAreaSub', g.id, 'tasks')"
                    >
                      <FIcon name="checklist" :size="12" class="sp-ico" />
                      <span class="sp-lbl">待办</span>
                      <span v-if="groupOpenCounts.get(g.id)" class="sp-cnt">{{ groupOpenCounts.get(g.id) }}</span>
                    </button>
                    <button
                      type="button"
                      class="stone-pill sub"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'overview' }"
                      @click="emit('openAreaSub', g.id, 'overview')"
                    >
                      <FIcon name="layers" :size="12" class="sp-ico" />
                      <span class="sp-lbl">概览</span>
                    </button>
                    <button
                      type="button"
                      class="stone-pill sub"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'calendar' }"
                      @click="emit('openAreaSub', g.id, 'calendar')"
                    >
                      <FIcon name="calendar" :size="12" class="sp-ico" />
                      <span class="sp-lbl">日历</span>
                    </button>
                    <button
                      type="button"
                      class="stone-pill sub"
                      :class="{ active: activeKind === 'area' && activeGroupId === g.id && areaSubTab === 'resources' }"
                      @click="emit('openAreaSub', g.id, 'resources')"
                    >
                      <FIcon name="folder" :size="12" class="sp-ico" />
                      <span class="sp-lbl">资料</span>
                    </button>
                  </div>
                </div>

                <div v-if="g.dividerAfter" class="sb-group-divider" role="separator" />
              </template>

              <div v-if="!groupList.length && !addingGroup" class="sb-empty">暂无分组，点击右上 + 新建</div>
            </div>
          </div>
        </section>
      </div>

      <!-- 1:1 Bottom 3-Slot Floating Utility Dock -->
      <footer class="sb-dock">
        <div class="sb-dock-left">
          <button
            ref="helpBtnRef"
            type="button"
            class="dock-ico"
            :class="{ active: helpOpen }"
            title="快捷键与操作指南"
            aria-label="快捷键与操作指南"
            @click="toggleHelpPop"
          >
            <FIcon name="help" :size="13" />
          </button>
          <button
            type="button"
            class="dock-ico"
            :class="{ active: activeKind === 'settings' }"
            title="偏好设置 (Ctrl+,)"
            aria-label="偏好设置"
            @click="emit('openSettings')"
          >
            <FIcon name="settings" :size="14" />
          </button>
          <button
            type="button"
            class="dock-ico"
            :title="wsTheme === 'dark' ? '切换浅色模式' : '切换深曜石暗色'"
            :aria-label="wsTheme === 'dark' ? '切换浅色模式' : '切换深曜石暗色'"
            @click="emit('toggleTheme')"
          >
            <Transition name="ws-icon-swap" mode="out-in">
              <FIcon :key="wsTheme" :name="wsTheme === 'dark' ? 'sun' : 'moon'" :size="14" />
            </Transition>
          </button>
          <button
            v-if="syncStatus.enabled"
            type="button"
            class="dock-ico"
            :class="{ spinning: syncStatus.syncing }"
            :title="`${statusLine(syncStatus)}（点击同步）`"
            @click="syncNow()"
          >
            <FIcon :name="syncStatus.error ? 'warning' : 'sync'" :size="13" />
          </button>
          <button
            v-if="isTauri"
            type="button"
            class="dock-ico"
            title="呼出桌面贴片日历"
            aria-label="呼出桌面贴片日历"
            @click="emit('summonDesk')"
          >
            <FIcon name="pin" :size="13" />
          </button>
        </div>

        <button
          type="button"
          class="dock-add-btn"
          title="快速新建任务 (Ctrl+N)"
          aria-label="快速新建任务"
          @click="emit('newTask')"
        >
          <FIcon name="add" :size="14" />
        </button>

        <button
          type="button"
          class="dock-ico"
          title="搜索与命令跳转 (Ctrl+K)"
          aria-label="搜索与命令跳转"
          @click="emit('quickSearch')"
        >
          <FIcon name="search" :size="14" />
        </button>
      </footer>
    </div>

    <Teleport to="body">
      <Transition name="sb-help-tr">
        <div
          v-if="helpOpen"
          ref="helpPopRef"
          class="sb-help-pop"
          :style="{ left: `${helpPos.left}px`, top: `${helpPos.top}px` }"
          role="dialog"
          aria-label="快捷键与工作台指南"
        >
          <div class="shp-head">快捷键与操作指南</div>
          <div class="shp-list">
            <div v-for="tip in SHORTCUT_TIPS" :key="tip.keys" class="shp-row">
              <span class="shp-desc">{{ tip.desc }}</span>
              <kbd class="shp-kbd">{{ tip.keys }}</kbd>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>

<style scoped>
.ws-sidebar {
  width: 100%;
  height: 100%;
  background: var(--ws-sidebar-bg);
  overflow: hidden;
}

.ws-sidebar-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px 8px 10px 10px;
  box-sizing: border-box;
}

.sb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 2px 10px;
}

.sb-ws-btn {
  min-width: 0;
  max-width: calc(100% - 30px);
  border: 0;
  background: transparent;
  padding: 4px 7px 4px 4px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  color: var(--ws-ink);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.sb-ws-btn:hover {
  background: var(--ws-stone-pill);
}

.sb-brand-name {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-brand-chev {
  color: var(--ws-ink-muted);
}

.sb-col-btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.sb-col-btn:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.sb-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

/* Tactile Stone Pills (compact width: fit-content, floating pure white when active) */
.sb-nav {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.stone-pill {
  position: relative;
  overflow: hidden;
  height: 27px;
  max-width: 100%;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: 8px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition:
    background-color 130ms ease,
    color 130ms ease,
    box-shadow 140ms ease,
    transform 140ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.stone-pill > * {
  position: relative;
  z-index: 1;
}

.stone-pill.drop-over,
.sb-group-btn.drop-over {
  background: color-mix(in srgb, #e85d2a 13%, var(--ws-card-bg));
  color: var(--ws-ink);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #e85d2a 48%, transparent);
  transform: scale(1.025);
}

.stone-pill.spring-charging::after,
.sb-group-btn.spring-charging::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, #e85d2a 20%, transparent);
  transform-origin: left center;
  animation: ws-spring-charge var(--spring-ms, 450ms) linear forwards;
  pointer-events: none;
  z-index: 0;
}

.sb-group-btn {
  position: relative;
  overflow: hidden;
}

.sb-section.drop-star-sec {
  border-radius: 10px;
  background: color-mix(in srgb, #f59e0b 11%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #f59e0b 45%, transparent);
}

.stone-pill:hover:not(.active) {
  background: var(--ws-stone-pill-hover);
  color: var(--ws-ink);
}

.stone-pill:active {
  transform: scale(0.98);
}

.stone-pill.active {
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
}

.stone-pill.sub {
  height: 25px;
  font-size: 12px;
}

.sp-ico {
  opacity: 0.78;
  flex: none;
}

.stone-pill.active .sp-ico {
  opacity: 1;
}

.sp-lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-cnt {
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ws-ink-muted);
}

.sb-section {
  margin-top: 15px;
}

.sb-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 5px;
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
  color: var(--ws-ink-secondary);
  cursor: pointer;
}

.sb-sec-toggle:hover {
  color: var(--ws-ink);
}

.sb-chev {
  transition: transform 180ms var(--ws-ease-out);
  transform: rotate(-90deg);
}

.sb-chev.open {
  transform: rotate(0deg);
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
}

.sb-sec-add:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.sb-accordion {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 210ms var(--ws-ease-out), opacity 160ms ease;
}

.sb-accordion.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.sb-accordion-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Starred Pills */
.sb-star-list {
  gap: 4px;
}

.star-pill {
  width: 100%;
  height: 28px;
  padding: 0 6px 0 9px;
  border: 0;
  border-radius: 8px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 120ms ease;
}

.star-pill:hover {
  background: var(--ws-stone-pill-hover);
}

.star-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star-unpin {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
  flex: none;
  transition: opacity 110ms ease, background-color 110ms ease, color 110ms ease;
}

.star-pill:hover .star-unpin,
.star-unpin:focus-visible {
  opacity: 1;
}

.star-unpin:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

/* Expandable Groups Tree */
.sb-groups-tree {
  gap: 3px;
}

.sb-group-node {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sb-group-btn {
  width: 100%;
  height: 28px;
  padding: 0 6px 0 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.sb-group-btn:hover {
  background: var(--ws-stone-pill);
}

.sb-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-g-chev {
  color: var(--ws-ink-muted);
  transition: transform 160ms var(--ws-ease-out);
  transform: rotate(-90deg);
}

.sb-g-chev.open {
  transform: rotate(0deg);
}

.sb-group-subs {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding-left: 16px;
  padding-bottom: 3px;
}

.sb-group-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--ws-hairline);
}

.sb-group-form {
  padding: 2px 4px 4px;
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
  outline: none;
}

.sb-empty {
  padding: 4px 6px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

/* Bottom 3-Slot Floating Utility Dock */
.sb-dock {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 8px 2px 2px;
  margin-top: 4px;
}

.sb-dock-left {
  display: flex;
  align-items: center;
  gap: 1px;
}

.dock-ico {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dock-ico:hover,
.dock-ico.active {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.dock-add-btn {
  width: 30px;
  height: 26px;
  border: 1px solid var(--ws-hairline);
  border-radius: 9px;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--ws-shadow-sm);
  transition: transform 120ms var(--ws-ease-out), border-color 130ms ease;
}

.dock-add-btn:hover {
  border-color: var(--ws-hairline-strong);
}

.dock-add-btn:active {
  transform: scale(0.95);
}

.spinning :deep(.f-icon) {
  animation: ws-spin 1s linear infinite;
}

@keyframes ws-spin {
  to {
    transform: rotate(360deg);
  }
}

.sb-help-pop {
  position: fixed;
  z-index: 95;
  width: 276px;
  padding: 10px;
  border-radius: 13px;
  background: var(--ws-card-bg, #ffffff);
  border: 1px solid var(--ws-hairline-strong, rgba(28, 25, 23, 0.14));
  box-shadow: var(--ws-shadow-float);
  color: var(--ws-ink);
  font-family: var(--font-ui);
}

.shp-head {
  font-size: 12px;
  font-weight: 650;
  color: var(--ws-ink-secondary);
  padding: 2px 4px 8px;
  border-bottom: 1px solid var(--ws-hairline);
  margin-bottom: 6px;
}

.shp-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.shp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 4px;
  font-size: 12px;
}

.shp-desc {
  color: var(--ws-ink);
}

.shp-kbd {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
  color: var(--ws-ink-secondary);
  flex: none;
}

.sb-help-tr-enter-active {
  transition: opacity 140ms var(--ws-ease-out), transform 150ms var(--ws-ease-out);
}

.sb-help-tr-leave-active {
  transition: opacity 90ms ease;
}

.sb-help-tr-enter-from,
.sb-help-tr-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
