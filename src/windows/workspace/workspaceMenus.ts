import { confirm, showMenu, TASK_COLORS, taskColor, type MenuItem } from '@/fluent';
import type { Group, ISODate, Task, TaskPriority, TaskStatus } from '@/types';
import { addDays, diffDays, weekday } from '@/lib/date';
import { flexKind, MONTH } from '@/lib/flex';
import { buildGroupIconMenuItems, getGroupIcon } from '@/lib/groupIcons';
import { deleteTask, duplicateTask, saveGroup, saveTask, setOccurrenceDone } from '@/lib/tasks';
import {
  applyTaskStatus,
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, groupList } from '@/stores/doc';
import { removeTask } from '../desk/menus';
import { notify } from '../desk/state';
import type { WorkspaceTab } from './workspaceModel';

export type MenuAt = Parameters<typeof showMenu>[1];

export const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  in_review: '#3B82F6',
  in_progress: '#D97706',
  todo: '#8E8A82',
  backlog: '#8B8862',
  done: '#22C55E',
};

export function buildGroupColorMenuItems(
  currentColor: string | undefined,
  dark: boolean,
  onPick: (key: string) => void,
  onPreview?: (key: string) => void,
): MenuItem[] {
  return TASK_COLORS.map((c) => ({
    key: `color:${c.key}`,
    label: c.label,
    colorDot: taskColor(c.key, dark).bar,
    radio: true,
    checked: (currentColor || 'blue') === c.key,
    onHover: onPreview ? () => onPreview(c.key) : undefined,
    action: () => onPick(c.key),
  }));
}

export function buildGroupSelectionMenuItems(
  selectedGroupId: string | undefined,
  onSelect: (groupId: string | undefined) => void,
  opts: { allowNone?: boolean; noneLabel?: string; includeUngrouped?: boolean; selectedIsUngrouped?: boolean } = {},
): MenuItem[] {
  const { allowNone = true, noneLabel = '无分组', includeUngrouped = false, selectedIsUngrouped = false } = opts;
  const items: MenuItem[] = [];
  if (allowNone) {
    items.push({
      key: 'grp:none',
      label: noneLabel,
      colorDot: '#9E9990',
      radio: true,
      checked: !selectedIsUngrouped && !selectedGroupId,
      action: () => onSelect(undefined),
    });
  }
  if (groupList.value.length) {
    if (allowNone) items.push({ separator: true });
    for (const g of groupList.value) {
      const def = getGroupIcon(g.icon);
      const hex = taskColor(g.color, isDark.value).bar;
      items.push({
        key: `grp:${g.id}`,
        label: g.name,
        svgPaths: def?.paths,
        colorDot: def ? undefined : hex,
        radio: true,
        checked: !selectedIsUngrouped && selectedGroupId === g.id,
        action: () => onSelect(g.id),
      });
    }
  }
  if (includeUngrouped) {
    items.push({ separator: true });
    items.push({
      key: 'grp:__ungrouped__',
      label: '仅未分组',
      colorDot: '#9E9990',
      radio: true,
      checked: selectedIsUngrouped,
      action: () => onSelect('__ungrouped__'),
    });
  }
  return items;
}

export function buildGroupCustomizeChildren(
  g: Group,
  opts: {
    onPreviewIcon?: (iconKey: string | undefined) => void;
    onPreviewColor?: (colorKey: string) => void;
    onResetPreview?: () => void;
  } = {},
): {
  iconItems: MenuItem[];
  colorItems: MenuItem[];
} {
  const hex = taskColor(g.color, isDark.value).bar;
  const iconItems = buildGroupIconMenuItems(
    g.icon,
    hex,
    (key) => {
      opts.onResetPreview?.();
      void saveGroup({ ...g, icon: key });
    },
    opts.onPreviewIcon,
  );
  const colorItems = buildGroupColorMenuItems(
    g.color,
    isDark.value,
    (key) => {
      opts.onResetPreview?.();
      void saveGroup({ ...g, color: key || 'blue' });
    },
    opts.onPreviewColor,
  );
  return { iconItems, colorItems };
}

function toggleTaskDoneForContext(t: Task, date: ISODate | undefined, currentlyDone: boolean) {
  const todayIso = now.value;
  if (flexKind(t)) {
    const slot = flexKind(t) === MONTH ? `m:${todayIso.slice(0, 7)}` : 's:';
    void setOccurrenceDone(t, slot, !currentlyDone);
    return;
  }
  if (t.repeat) {
    void setOccurrenceDone(t, date ?? todayIso, !currentlyDone);
    return;
  }
  void saveTask(applyTaskStatus(t, currentlyDone ? 'todo' : 'done'));
}

function nextMondayIso(todayIso: ISODate): ISODate {
  const wd = weekday(todayIso);
  const delta = wd === 0 ? 1 : 8 - wd;
  return addDays(todayIso, delta);
}

export function openTaskContextMenu(
  t: Task,
  at: MenuAt,
  opts: { date?: ISODate; onOpen: () => void },
): Promise<void> {
  const todayIso = now.value;
  const status = effectiveWorkspaceStatus(t);
  const priority = effectivePriority(t);
  const isDone = t.repeat ? !!t.doneDates?.includes(opts.date ?? todayIso) : status === 'done';
  const spanDays = Math.max(0, diffDays(t.start, t.end));
  const monday = nextMondayIso(todayIso);
  const tomorrow = addDays(todayIso, 1);

  const scheduleTo = (targetStart: ISODate) => {
    void saveTask({
      ...t,
      flex: undefined,
      flexDone: undefined,
      start: targetStart,
      end: addDays(targetStart, spanDays),
    });
  };

  const statusChildren: MenuItem[] = WORKSPACE_STATUS_ORDER.map((st) => ({
    key: `st:${st}`,
    label: STATUS_META[st].label,
    colorDot: STATUS_DOT_COLOR[st],
    radio: true,
    checked: status === st,
    action: () => void saveTask(applyTaskStatus(t, st)),
  }));

  const priorityChildren: MenuItem[] = PRIORITY_ORDER.map((p: TaskPriority) => ({
    key: `pri:${p}`,
    label: PRIORITY_META[p].label,
    colorDot: PRIORITY_META[p].color,
    radio: true,
    checked: priority === p,
    action: () => void saveTask({ ...t, priority: p === 'none' ? undefined : p }),
  }));

  const scheduleChildren: MenuItem[] = [
    {
      key: 'sch:today',
      label: '今天',
      icon: 'today',
      radio: true,
      checked: !t.flex && t.start <= todayIso && t.end >= todayIso,
      action: () => scheduleTo(todayIso),
    },
    {
      key: 'sch:tomorrow',
      label: '明天',
      icon: 'forward',
      radio: true,
      checked: !t.flex && t.start === tomorrow,
      action: () => scheduleTo(tomorrow),
    },
    {
      key: 'sch:nextmon',
      label: '下周一',
      icon: 'calendar',
      radio: true,
      checked: !t.flex && t.start === monday,
      action: () => scheduleTo(monday),
    },
    { separator: true },
    {
      key: 'sch:inbox',
      label: '放入收集箱（不定日）',
      icon: 'flag',
      radio: true,
      checked: !!flexKind(t),
      action: () =>
        void saveTask({
          ...t,
          flex: 'someday',
          time: undefined,
          duration: undefined,
        }),
    },
  ];

  const groupChildren = buildGroupSelectionMenuItems(
    t.groupId && doc.groups[t.groupId] ? t.groupId : undefined,
    (gid) => void saveTask({ ...t, groupId: gid }),
  );

  const items: (MenuItem | false)[] = [
    { key: 'open', label: '打开详情', icon: 'edit', shortcut: 'Enter', action: opts.onOpen },
    {
      key: 'toggle-done',
      label: isDone ? '标为未完成' : '标为已完成',
      icon: 'completed',
      checked: isDone,
      action: () => toggleTaskDoneForContext(t, opts.date, isDone),
    },
    {
      key: 'star',
      label: t.starred ? '取消星标置顶' : '加入星标置顶',
      icon: t.starred ? 'starFill' : 'star',
      checked: !!t.starred,
      action: () => void saveTask({ ...t, starred: !t.starred || undefined }),
    },
    { separator: true },
    !t.repeat && { key: 'status', label: '切换状态', icon: 'sliders', children: statusChildren },
    { key: 'priority', label: '优先级…', icon: 'warning', children: priorityChildren },
    !t.repeat && { key: 'schedule', label: '改期到…', icon: 'calendar', children: scheduleChildren },
    { key: 'group', label: '移动到分组…', icon: 'group', children: groupChildren },
    {
      key: 'countdown',
      label: '显示为倒数日',
      icon: 'flag',
      checked: !!t.countdown,
      action: () => void saveTask({ ...t, countdown: !t.countdown || undefined }),
    },
    { separator: true },
    {
      key: 'dup',
      label: '复制任务',
      icon: 'copy',
      action: () => void duplicateTask(t).then(() => notify('已复制任务')),
    },
    t.repeat && opts.date
      ? {
          key: 'del',
          label: '删除重复任务',
          icon: 'delete',
          danger: true,
          children: [
            { key: 'del:this', label: '仅删除这一次', action: () => void removeTask(t, opts.date, 'this') },
            { key: 'del:future', label: '删除这一次及以后', action: () => void removeTask(t, opts.date, 'future') },
            { key: 'del:all', label: '删除全部重复', danger: true, action: () => void removeTask(t, opts.date, 'all') },
          ],
        }
      : {
          key: 'del',
          label: '删除任务',
          icon: 'delete',
          danger: true,
          action: () => void removeTask(t),
        },
  ];

  return showMenu(items.filter(Boolean) as MenuItem[], at);
}

export function openTabContextMenu(
  tab: WorkspaceTab,
  tabs: WorkspaceTab[],
  at: MenuAt,
  actions: {
    onCloseSelf: () => void;
    onCloseOthers: () => void;
    onCloseRight: () => void;
    onOpenHome: () => void;
    onNewTask: () => void;
  },
): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === tab.id);
  const canCloseSelf = tab.closable !== false && tabs.length > 1;
  const canCloseOthers = tabs.some((t) => t.id !== tab.id && t.closable !== false);
  const canCloseRight = idx >= 0 && tabs.slice(idx + 1).some((t) => t.closable !== false);

  const items: MenuItem[] = [
    {
      key: 'close',
      label: '关闭此标签页',
      shortcut: 'Ctrl+W',
      disabled: !canCloseSelf,
      action: actions.onCloseSelf,
    },
    {
      key: 'close-others',
      label: '关闭其他标签页',
      disabled: !canCloseOthers,
      action: actions.onCloseOthers,
    },
    {
      key: 'close-right',
      label: '关闭右侧标签页',
      disabled: !canCloseRight,
      action: actions.onCloseRight,
    },
    { separator: true },
    { key: 'home', label: '回到今日聚焦', icon: 'home', action: actions.onOpenHome },
    { key: 'new', label: '快速新建任务', icon: 'add', shortcut: 'Ctrl+N', action: actions.onNewTask },
  ];

  return showMenu(items, at);
}

export function openCountdownContextMenu(
  t: Task,
  at: MenuAt,
  actions: { onEdit: () => void },
): Promise<void> {
  const mode = t.countdownMode === 'up' ? 'up' : 'down';
  const items: MenuItem[] = [
    { key: 'edit', label: '编辑倒数日…', icon: 'edit', action: actions.onEdit },
    {
      key: 'pin',
      label: t.countdownPinned ? '取消置顶' : '置顶到最前',
      icon: t.countdownPinned ? 'unpin' : 'pin',
      checked: !!t.countdownPinned,
      action: () => void saveTask({ ...t, countdownPinned: !t.countdownPinned || undefined }),
    },
    {
      key: 'mode',
      label: '计天方式',
      icon: 'switchArrows',
      children: [
        {
          key: 'mode:down',
          label: '目标倒数（距离还有）',
          radio: true,
          checked: mode === 'down',
          action: () => void saveTask({ ...t, countdownMode: 'down' }),
        },
        {
          key: 'mode:up',
          label: '纪念正数（已经过去）',
          radio: true,
          checked: mode === 'up',
          action: () => void saveTask({ ...t, countdownMode: 'up' }),
        },
      ],
    },
    {
      key: 'cal',
      label: '在日历格子中显示',
      icon: 'calendar',
      checked: !t.countdownOnly,
      action: () => void saveTask({ ...t, countdownOnly: t.countdownOnly ? undefined : true }),
    },
    { separator: true },
    {
      key: 'del',
      label: '删除倒数日',
      icon: 'delete',
      danger: true,
      action: async () => {
        const res = await confirm({
          title: `删除倒数日“${t.title}”？`,
          primaryText: '删除',
          danger: true,
        });
        if (res !== 'primary') return;
        await deleteTask(t.id);
        notify(`已删除倒数日“${t.title}”`, true);
      },
    },
  ];

  return showMenu(items, at);
}

export function openStageContextMenu(
  at: MenuAt,
  actions: {
    wsTheme: 'light' | 'dark';
    sidebarOpen: boolean;
    onNewTask: () => void;
    onQuickSearch: () => void;
    onToggleTheme: () => void;
    onToggleSidebar: () => void;
  },
): Promise<void> {
  const items: MenuItem[] = [
    { key: 'new', label: '快速新建任务', icon: 'add', shortcut: 'Ctrl+N', action: actions.onNewTask },
    { key: 'search', label: '搜索与跳转…', icon: 'search', shortcut: 'Ctrl+K', action: actions.onQuickSearch },
    { separator: true },
    {
      key: 'theme',
      label: actions.wsTheme === 'dark' ? '切换为浅色工作台' : '切换为深曜石暗色',
      icon: actions.wsTheme === 'dark' ? 'sun' : 'moon',
      action: actions.onToggleTheme,
    },
    {
      key: 'sidebar',
      label: actions.sidebarOpen ? '收起侧边栏' : '展开侧边栏',
      icon: 'sidebar',
      shortcut: 'Ctrl+B',
      action: actions.onToggleSidebar,
    },
  ];

  return showMenu(items, at);
}
