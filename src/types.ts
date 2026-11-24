/** YYYY-MM-DD in local time. */
export type ISODate = string;

export type RepeatFreq =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'workday' // Monday–Friday
  | 'legalWorkday' // working days per the official holiday schedule (incl. 调休)
  | 'lunarYearly'
  | 'monthLastDay'
  | 'ebbinghaus';

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every N days/weeks/months/years. Default 1. */
  interval?: number;
  /** weekly: 0 = Sunday … 6 = Saturday. Defaults to the start date's weekday. */
  weekdays?: number[];
  /** monthly: same date each month, or the same "Nth weekday" (e.g. second Tuesday). */
  monthMode?: 'day' | 'nthWeekday';
  /** Stop after this many occurrences. */
  count?: number;
  /** Last allowed occurrence start (inclusive). */
  until?: ISODate;
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export type SubscriptionCycle = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
export type SubscriptionCurrency = 'CNY' | 'USD' | 'HKD' | 'EUR' | 'JPY' | 'GBP';
export type SubscriptionCategory = 'ai' | 'cloud' | 'media' | 'life' | 'work' | 'other';
/**
 * active    = 订阅中（按周期自动续费或持续订阅）
 * ending    = 已关续费（已付费生效中，但关闭了自动续费，本期到期即止）
 * trial     = 试用中（试用护盾）
 * paused    = 已暂停
 * cancelled = 已退订
 */
export type SubscriptionStatus = 'active' | 'ending' | 'trial' | 'paused' | 'cancelled';

export interface SubscriptionSubAccount {
  id: string;
  /** Account nickname / email label, e.g. "工作号", "备用美区号" */
  label: string;
  /** Optional tier / plan name, e.g. "Plus", "Pro", "Max 5x", "Team", "API" */
  plan?: string;
  /** Price per billing cycle (in `currency` or parent's currency). */
  price: number;
  currency?: SubscriptionCurrency;
  cycle?: SubscriptionCycle;
  status?: SubscriptionStatus;
  autoRenew?: boolean;
  /** Optional independent due/expiry date for this sub-account. */
  nextDate?: ISODate;
  /** Optional recurring discount off per cycle. */
  discountAmount?: number;
  /** Optional introductory / first-period promotional price. */
  promoPrice?: number;
  note?: string;
}

export interface SubscriptionMeta {
  /** Original price per billing cycle (before discount & split-bill division). */
  price: number;
  currency: SubscriptionCurrency;
  cycle: SubscriptionCycle;
  category: SubscriptionCategory;
  status: SubscriptionStatus;
  autoRenew: boolean;
  /** Optional plan / tier label, e.g. "Plus", "Pro", "Max", "黑胶VIP". */
  plan?: string;
  /** Recurring discount / coupon off per billing cycle in `currency` (e.g. ¥5 off ¥20 -> ¥15). */
  discountAmount?: number;
  /** Introductory / first-period promotional price in `currency` (e.g. 首月 ¥1). */
  promoPrice?: number;
  /** Number of initial cycles covered by `promoPrice` (default 1 = 首月/首期优惠). */
  promoPeriods?: number;
  /** Optional custom label for the discount or intro promo (e.g. "首月特惠", "学生价"). */
  promoLabel?: string;
  /** Additional child sub-subscriptions / accounts under the same service (e.g. multiple ChatGPT/Claude accounts). */
  accounts?: SubscriptionSubAccount[];
  /** Split bill across N people (default 1 = personal; e.g. 6 = family split, pays 1/6). */
  splitCount?: number;
  /** Payment channel note (e.g. 'Apple 订阅', '微信自动扣款', 'Visa 4242'). */
  paymentMethod?: string;
  /** Compact emblem glyph/monogram displayed on calendar & membership cards. */
  emblem?: string;
  /** Built-in curated brand key (e.g. 'chatgpt', 'bilibili', 'spotify') for crisp offline SVG rendering. */
  brandKey?: string;
  /** Inline Data URL (data:image/webp|png|svg+xml;base64,...) cached locally after online search or upload. */
  iconData?: string;
  /** Custom hex or preset brand color for gradient cards & badges. */
  brandColor?: string;
  /** Optional giant background watermark text for editorial cards. */
  watermark?: string;
  /** Days before next charge to highlight/remind (default 2). */
  remindDaysBefore?: number;
  /** Optional: also expose renewal events on the main calendar grid. */
  showOnCalendar?: boolean;
}

export type HabitKind = 'check' | 'count' | 'quit';
export type HabitTimeOfDay = 'anytime' | 'morning' | 'afternoon' | 'evening';
/** macOS-style interactive card widget visualizations (type-tailored defaults, non-heatmap by default). */
export type HabitWidgetStyle =
  | 'window'
  | 'spectrum'
  | 'rings'
  | 'bars'
  | 'gauge'
  | 'journey'
  | 'pillars'
  | 'heatmap';
/** Per-day habit log: positive number = count/check, 'skip' = rest day (anti-guilt), 'relapse' = quit slip. */
export type HabitLogValue = number | 'skip' | 'relapse';

export interface HabitMeta {
  kind: HabitKind;
  /** Target per day for `count` habits (e.g. 8 cups, 30 mins). Default 1 for `check`/`quit`. */
  target: number;
  /** Quick increment step per tap on `count` habits (e.g. 1, 10, 250). Default 1. */
  step?: number;
  /** Display unit for `count` habits (e.g. '杯', '分钟', '步', '页'). */
  unit?: string;
  /** Elastic weekly quota (1..7; 7 = daily, e.g. 3 = "每周 3 次"). */
  weeklyTarget: number;
  timeOfDay: HabitTimeOfDay;
  /** Optional fixed daily scheduled time window ("HH:MM", e.g. "07:15" - "08:00") for live countdown widgets. */
  windowStart?: string;
  windowEnd?: string;
  /** Built-in curated vector icon key (e.g. 'water', 'book', 'meditate', 'moon'). */
  iconKey?: string;
  /** Hex theme color driving Fushi tonal card & macOS habit widgets. */
  color: string;
  /** Preferred macOS widget visualization style; omitted = smart default by habit type. */
  widgetStyle?: HabitWidgetStyle;
  /** Archived habits are hidden from the daily grid while keeping full history. */
  archived?: boolean;
  /** Daily completion map keyed by YYYY-MM-DD. */
  logs: Record<ISODate, HabitLogValue>;
  /** Per-day local check-in timestamps ("HH:MM"[]) recorded automatically for chronotype & time-of-day analytics. */
  logTimes?: Record<ISODate, string[]>;
}

export interface TaskCheckItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskLink {
  id: string;
  title: string;
  url: string;
}

export interface Task {
  /** 不定日待办 (GitHub #7): "month" = once every month on whichever day, "someday" = no date. */
  flex?: string;
  /** Flex tasks: the day each slot was done ("2026-11" → "2026-11-20"; "" for someday). */
  flexDone?: Record<string, string>;
  id: string;
  title: string;
  notes?: string;
  start: ISODate;
  /** Inclusive end date. */
  end: ISODate;
  /** HH:mm; empty = all day. */
  time?: string;
  /** Duration in minutes for timed tasks; defaults to 60 when `time` is set. */
  duration?: number;
  /** Workflow status synced with `done` and `progress`. */
  status?: TaskStatus;
  /** Optional priority tier shown in Tegon-style workspace lists and filter bar. */
  priority?: TaskPriority;
  /** Pinned into the Workspace Starred section for quick access and hover preview. */
  starred?: boolean;
  /** Structured subtasks rendered as a connected checklist in Workspace Inspector. */
  checklist?: TaskCheckItem[];
  /** Related URLs or local paths shown in Workspace Inspector. */
  links?: TaskLink[];
  /** TASK_COLORS key or #RRGGBB; empty = default. */
  color?: string;
  groupId?: string;
  /** 0–100 */
  progress: number;
  done: boolean;
  milestone?: boolean;
  /** Predecessor task ids (finish-to-start). */
  deps?: string[];
  /** Minutes before the occurrence (0 = on time). All-day tasks use settings.reminders.allDayTime. */
  reminders?: number[];
  repeat?: RepeatRule;
  /** Repeating tasks: occurrence start dates marked done. */
  doneDates?: ISODate[];
  /** The day the task was ticked done (GitHub #15; lib/tasks.ts `stampDone`): written with
   * `done`, gone with it. A task done before this was recorded has none. */
  doneOn?: ISODate;
  /** Repeating tasks: occurrence start → the day it was ticked done. */
  doneOnDates?: Record<ISODate, ISODate>;
  /** Repeating tasks: occurrence start dates deleted. */
  exDates?: ISODate[];
  /** Show "N days until" at the bottom of the calendar. */
  countdown?: boolean;
  /** Standalone custom countdown (kept hidden from todo lists / inbox / gantt / calendar grid). */
  countdownOnly?: boolean;
  /** 'down' = countdown to target; 'up' = elapsed days anniversary counter. */
  countdownMode?: CountdownMode;
  /** Pin this countdown to the front of CountdownBar and Workspace spotlight. */
  countdownPinned?: boolean;
  /** Standalone subscription membership record (shown in Subscription Calendar, hidden from todo/inbox/gantt). */
  subscriptionOnly?: boolean;
  /** Structured billing/cycle/currency metadata for subscription records. */
  subscription?: SubscriptionMeta;
  /** Standalone daily habit record (shown in HabitView & Today Quick Strip, hidden from todo/inbox/calendar/gantt). */
  habitOnly?: boolean;
  /** Structured frequency, icon, logs & anti-guilt metadata for daily habits. */
  habit?: HabitMeta;
  /** Overrides settings.tasks.autoPostpone for this task. */
  autoPostpone?: boolean;
  /** First-run sample data ("清除示例数据" removes it); dropped once the user renames it. */
  sample?: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  /** Optional monoline icon key from src/lib/groupIcons. */
  icon?: string;
  /** Render a thin separator line after this group in sidebars. */
  dividerAfter?: boolean;
  collapsed?: boolean;
  /** First-run sample data. */
  sample?: boolean;
  order: number;
}

export interface DayMark {
  color: string;
}

export interface HolidayYear {
  year: number;
  fetchedAt: number;
  days: { date: ISODate; name: string; isOffDay: boolean }[];
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type PinMode = 'desktop' | 'top' | 'normal';
export type CalendarView = 'day' | 'multiday' | 'month' | 'weeks' | 'gantt' | 'list';
export type GanttScale = 'day' | 'week' | 'month';
export type CountdownMode = 'down' | 'up';

export interface Settings {
  /** onboarded: the first-run welcome bar was dismissed (or the samples cleared). */
  general: { language: 'system' | 'zh-CN' | 'zh-TW' | 'en-US'; autostart: boolean; seeded: boolean; onboarded: boolean };
  theme: {
    mode: ThemeMode;
    /** 'system' or a CSS hex colour (#RGB[A] / #RRGGBB[AA]). */
    accent: string;
    reduceMotion: boolean;
  };
  desk: {
    pinMode: PinMode;
    locked: boolean;
    sidebarOpen: boolean;
    sidebarWidth: number;
    sidebarExternalSized: boolean;
    clickThrough: boolean;
    /** Desktop mode: clicks don't activate the window (keeps Win+D working). */
    noActivate: boolean;
    acrylic: boolean;
    /** 'auto' (follows theme) or #RRGGBB */
    bgColor: string;
    /** Outer shell / divider frame color ('auto' or #RRGGBB). */
    frameColor: string;
    /** 0–100 */
    bgOpacity: number;
    /** Opacity of the day cells, 0–100 */
    cellOpacity: number;
    radius: number;
    shadow: boolean;
    /** 'auto' | 'on' | 'off' */
    textShadow: 'auto' | 'on' | 'off';
    /** UI family choice; auto uses the Windows Fluent UI font stack. */
    fontFamily: 'auto' | 'segoe-variable' | 'segoe' | 'yahei-ui' | 'yahei' | 'arial';
    /** 'auto' adapts to the configured date-cell surface; otherwise a hex colour. */
    textColor: string;
    /** Calendar text improves readability; task retains per-task/per-group title colours. */
    taskTextMode: 'calendar' | 'task';
    /** Text outline radius in pixels, 0–4. */
    textOutlineWidth: number;
    fontScale: number;
    cellGap: number;
    lineSpacing: number;
    todayBorderColor: string;
    todayBorderWidth: number;
    todayFillColor: string;
    restBgColor: string;
    holidayTextColor: string;
    termTextColor: string;
    /** Where the user put the calendar (physical px) and the screen it was on, written by
     * Rust (layout.rs): [device name, screen rect, scale]. */
    bounds?: { x: number; y: number; w: number; h: number; monitor?: [string, { x: number; y: number; w: number; h: number }, number] | null };
  };
  calendar: {
    view: CalendarView;
    /** The list view: 近期 (today on) or 所有 (every task once). */
    listRange: 'upcoming' | 'all';
    listGroupLabels: boolean;
    weekStart: 0 | 1;
    monthRows: 'auto' | 'six';
    /** Busy weeks get taller rows (the PC calendar; the web view keeps equal rows). */
    fitRows: boolean;
    /** Where the to-do column takes its room: beside the calendar, left of the window, or over it. */
    sidebarMode: 'inline' | 'left' | 'float';
    /** How the floating column closes: its handle again, or also a press anywhere outside it. */
    sidebarClose: 'button' | 'outside';
    /** Bars over several days say which day it is (GitHub #13). */
    barDays: boolean;
    /** … and the task's progress (GitHub #10, #13). */
    barProgress: boolean;
    /** … and, once done, the day it was ticked (GitHub #15). */
    barDone: boolean;
    weeksRows: number;
    weeksPast: number;
    showLunar: boolean;
    showHolidays: boolean;
    showWeekNumbers: boolean;
    showAlmanac: boolean;
    /** Include statutory holidays as a countdown source. */
    holidayCountdown: boolean;
    countdownFestival: boolean;
    countdownTerm: boolean;
    ungroupedColor: string;
    countdownMarked: boolean;
    countdownGroups: string[];
    /** 0 = Sunday … 6 = Saturday */
    restDays: number[];
  };
  tasks: {
    showCompleted: boolean;
    completedLast: boolean;
    autoPostpone: boolean;
    defaultColor: string;
  };
  gantt: {
    scale: GanttScale;
    tableWidth: number;
    showTable: boolean;
    hideDone: boolean;
    hideSingleDay: boolean;
    showDeps: boolean;
    groupFilter: string[];
  };
  reminders: {
    enabled: boolean;
    /** Windows notification, popup card in the corner, or both. */
    style: 'toast' | 'popup' | 'both';
    allDayTime: string;
    defaultOffsets: number[];
  };
  holidays: { autoUpdate: boolean; lastCheck: number };
  shortcuts: { toggle: string; newTask: string };
  /** Cloud sync (SYN). Per PC; passwords and tokens are in Windows Credential Manager. */
  /** Web view in the local network (WEB). Per PC; the access code is in Credential Manager. */
  web: { enabled: boolean; port: number };
  /** AI assistants over MCP (MCP), desktop only. Per PC; the token is in Credential Manager.
   *  `write`: assistants may change the calendar, not only look. */
  mcp: { enabled: boolean; port: number; write: boolean };
  sync: {
    enabled: boolean;
    /** '' = off; 'folder' = a shared data folder (DAT-04), not a network sync. */
    provider: SyncProvider;
    /** Minutes between pulls; 0 = only after start and edits. */
    interval: number;
    /** '' = Windows system proxy, 'direct' = none, otherwise http://host:port. */
    proxy: string;
    webdav: { url: string; user: string; folder: string };
    github: { repo: string; branch: string; path: string };
    gitee: { repo: string; branch: string; path: string };
  };
}

export type SyncProvider = '' | 'webdav' | 'github' | 'gitee' | 'folder';

export interface Doc {
  version: number;
  /** Per-item edit timestamps, including deleted items, shared with desktop cloud sync. */
  meta?: Partial<Record<Collection, Record<string, number>>>;
  tasks: Record<string, Task>;
  groups: Record<string, Group>;
  dayMarks: Record<ISODate, DayMark>;
  holidays: Record<string, HolidayYear>;
  settings: Settings;
}

export type Collection = 'tasks' | 'groups' | 'dayMarks' | 'holidays';
