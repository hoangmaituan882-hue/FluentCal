import type { MenuItem } from '@/fluent/menu';

export interface GroupIconDef {
  key: string;
  label: string;
  section: 'default' | 'status' | 'work' | 'charts' | 'archive';
  paths: readonly string[];
}

export const GROUP_ICON_CATALOG: readonly GroupIconDef[] = [
  // Default
  {
    key: 'page',
    label: '页面',
    section: 'default',
    paths: [
      'M4 2.5h5.2L12.5 5.8v7.7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z',
      'M9.2 2.5v3.3h3.3',
    ],
  },
  // Status & Symbols
  {
    key: 'arrow',
    label: '流程',
    section: 'status',
    paths: ['M2.5 6.3h6V4l5 4-5 4V9.7h-6z'],
  },
  {
    key: 'padlock',
    label: '私密',
    section: 'status',
    paths: [
      'M4 7.5h8v5.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V7.5z',
      'M5.5 7.5V5.3a2.5 2.5 0 0 1 5 0v2.2',
    ],
  },
  {
    key: 'check',
    label: '完成',
    section: 'status',
    paths: ['M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M5.3 8.2 7.1 10l3.6-3.8'],
  },
  {
    key: 'cross',
    label: '排除',
    section: 'status',
    paths: ['M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M5.8 5.8l4.4 4.4', 'M10.2 5.8l-4.4 4.4'],
  },
  {
    key: 'info',
    label: '说明',
    section: 'status',
    paths: ['M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M8 7.4v3.4', 'M8 5.2v.2'],
  },
  {
    key: 'question',
    label: '疑问',
    section: 'status',
    paths: [
      'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
      'M6.3 6.2a1.8 1.8 0 0 1 3.5.5c0 1.2-1.8 1.4-1.8 2.5',
      'M8 11.4v.2',
    ],
  },
  // Creation & Workspace Tools
  {
    key: 'design',
    label: '设计',
    section: 'work',
    paths: [
      'M3 4.8 4.8 3 13 11.2 11.2 13z',
      'M10 3.2 12.8 6l-1.3 1.3',
      'M6 12.8 3.2 10l1.3-1.3',
      'M6 6.2 7 7.2',
      'M9 9.2l1 1',
    ],
  },
  {
    key: 'vector',
    label: '矢量',
    section: 'work',
    paths: [
      'M2.8 9.2c0-2.8 2.3-5 5.2-5s5.2 2.2 5.2 5',
      'M3.2 4.2h9.6',
      'M1.8 9.2h2v2h-2z',
      'M12.2 9.2h2v2h-2z',
      'M7 3.2h2v2H7z',
    ],
  },
  {
    key: 'images',
    label: '图片',
    section: 'work',
    paths: [
      'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
      'M3.2 11.8l3.2-3.4 2.2 2.2 2.2-2.6 2.7 3.8',
      'M5.5 6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z',
    ],
  },
  {
    key: 'table',
    label: '表格',
    section: 'work',
    paths: ['M2.5 3.2h11v9.6h-11z', 'M2.5 6.6h11', 'M6.4 3.2v9.6', 'M2.5 9.7h11'],
  },
  {
    key: 'presentation',
    label: '演示',
    section: 'work',
    paths: ['M2.2 3.2h11.6', 'M3.2 3.2v6.6h9.6V3.2', 'M8 9.8v3.4', 'M5.5 13.2 8 10.6l2.5 2.6'],
  },
  {
    key: 'blueprint',
    label: '蓝图',
    section: 'work',
    paths: ['M3 10.5 10.5 3 13 5.5 5.5 13z', 'M6.5 7 7.8 8.3', 'M8.5 5 9.8 6.3', 'M4.5 9 5.8 10.3'],
  },
  {
    key: 'swatches',
    label: '色板',
    section: 'work',
    paths: [
      'M3 2.8h3.4a.8.8 0 0 1 .8.8v8.8a.8.8 0 0 1-.8.8H3a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8z',
      'M7.2 4.6l3.2 1.2a.8.8 0 0 1 .5 1L8.5 12.6',
      'M10.2 8.2l3 2.1a.8.8 0 0 1 .2 1.1l-1 1.4H6.5',
    ],
  },
  // Charts & Data
  {
    key: 'barChart',
    label: '柱状图',
    section: 'charts',
    paths: ['M3.2 8.5h2.2v4.5H3.2z', 'M6.9 4.5h2.2v8.5H6.9z', 'M10.6 6.5h2.2v6.5h-2.2z'],
  },
  {
    key: 'lineChart',
    label: '折线图',
    section: 'charts',
    paths: ['M2.5 11.8 6 7.8 9 9.5 13.5 4.2', 'M2.5 8.5 6 5 9.5 6.8 13.5 3'],
  },
  {
    key: 'pieChart',
    label: '饼图',
    section: 'charts',
    paths: ['M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M8 2v6l4.4 4.1'],
  },
  // Archive
  {
    key: 'archive',
    label: '归档',
    section: 'archive',
    paths: [
      'M2.5 3.5h11v2.6h-11z',
      'M3.4 6.1v6.2a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V6.1',
      'M6.4 8.8h3.2',
    ],
  },
];

export const GROUP_ICONS_BY_KEY: Record<string, GroupIconDef> = Object.fromEntries(
  GROUP_ICON_CATALOG.map((d) => [d.key, d]),
);

export function getGroupIcon(key?: string): GroupIconDef | undefined {
  return key ? GROUP_ICONS_BY_KEY[key] : undefined;
}

const SECTION_ORDER: GroupIconDef['section'][] = ['default', 'status', 'work', 'charts', 'archive'];

/**
 * Builds semantic grouped MenuItem entries for custom group icon pickers
 * (left SVG icon + right checkmark + optional hover live preview).
 */
export function buildGroupIconMenuItems(
  currentIcon: string | undefined,
  dotColorHex: string,
  onPick: (key: string | undefined) => void,
  onPreview?: (key: string | undefined) => void,
): MenuItem[] {
  const items: MenuItem[] = [
    {
      key: 'icon:dot',
      label: '圆点（默认）',
      colorDot: dotColorHex,
      radio: true,
      checked: !currentIcon,
      onHover: onPreview ? () => onPreview(undefined) : undefined,
      action: () => onPick(undefined),
    },
  ];

  for (const sec of SECTION_ORDER) {
    const defs = GROUP_ICON_CATALOG.filter((d) => d.section === sec);
    if (!defs.length) continue;
    if (sec !== 'default') {
      items.push({ separator: true });
    }
    for (const def of defs) {
      items.push({
        key: `icon:${def.key}`,
        label: def.label,
        svgPaths: def.paths,
        radio: true,
        checked: currentIcon === def.key,
        onHover: onPreview ? () => onPreview(def.key) : undefined,
        action: () => onPick(def.key),
      });
    }
  }

  return items;
}
