import type { Settings, ThemeMode } from '@/types';
import type { DeepPartial } from '@/stores/doc';

export interface Preset {
  id: string;
  label: string;
  desc: string;
  /** Thumbnail: card background alpha, cell alpha, dark? */
  thumb: { bg: number; cell: number; dark: boolean; acrylic?: boolean; cream?: boolean };
  patch: DeepPartial<Settings>;
}

const desk = (p: Partial<Settings['desk']>) => ({ acrylic: false, bgColor: 'auto', frameColor: 'auto', shadow: true, textShadow: 'auto' as const, ...p });

export const PRESETS: Preset[] = [
  {
    id: 'cream',
    label: '奶油暖灰',
    desc: '温润奶油白与暖灰分隔',
    thumb: { bg: 1, cell: 0.92, dark: false, cream: true },
    patch: {
      theme: { mode: 'light' as ThemeMode, accent: '#E85A3C' },
      desk: desk({
        bgColor: '#FAF8F3',
        frameColor: '#EAE8E2',
        bgOpacity: 100,
        cellOpacity: 92,
        radius: 14,
        shadow: true,
        textColor: '#2B2825',
        todayBorderColor: '#E85A3C',
        todayBorderWidth: 2,
        todayFillColor: '#E85A3C1F',
        restBgColor: '#ECE8DF',
        holidayTextColor: '#D95338',
        termTextColor: '#B86A28',
      }),
    },
  },
  { id: 'light', label: '浅色卡片', desc: '明亮、清晰', thumb: { bg: 0.92, cell: 0.7, dark: false }, patch: { theme: { mode: 'light' as ThemeMode }, desk: desk({ bgOpacity: 92, cellOpacity: 70 }) } },
  { id: 'dark', label: '深色卡片', desc: '夜间不刺眼', thumb: { bg: 0.9, cell: 0.6, dark: true }, patch: { theme: { mode: 'dark' as ThemeMode }, desk: desk({ bgOpacity: 90, cellOpacity: 60 }) } },
  { id: 'acrylic', label: '亚克力', desc: 'Win11 毛玻璃', thumb: { bg: 0.45, cell: 0.4, dark: true, acrylic: true }, patch: { desk: desk({ acrylic: true, bgOpacity: 45, cellOpacity: 40, shadow: false }) } },
  { id: 'glass', label: '透明玻璃', desc: '透出壁纸', thumb: { bg: 0.18, cell: 0.38, dark: true }, patch: { desk: desk({ bgOpacity: 18, cellOpacity: 38, shadow: false }) } },
  { id: 'minimal', label: '极简', desc: '只显示文字', thumb: { bg: 0, cell: 0.1, dark: true }, patch: { desk: desk({ bgOpacity: 0, cellOpacity: 10, shadow: false, textShadow: 'on' }) } },
];

export function matchPreset(s: Settings): string {
  const d = s.desk;
  return (
    PRESETS.find((p) => {
      const pd = p.patch.desk!;
      return (
        pd.bgOpacity === d.bgOpacity &&
        pd.cellOpacity === d.cellOpacity &&
        pd.acrylic === d.acrylic &&
        (pd.bgColor ?? 'auto') === d.bgColor &&
        (pd.frameColor ?? 'auto') === d.frameColor
      );
    })?.id ?? ''
  );
}
