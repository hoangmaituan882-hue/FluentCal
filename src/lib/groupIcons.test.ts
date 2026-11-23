import { describe, expect, it } from 'vitest';
import { buildGroupIconMenuItems, getGroupIcon, GROUP_ICON_CATALOG } from './groupIcons';

describe('groupIcons catalog and menu builder', () => {
  it('defines unique keys and non-empty SVG paths for all monoline icons', () => {
    const keys = GROUP_ICON_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of GROUP_ICON_CATALOG) {
      expect(def.label.trim().length).toBeGreaterThan(0);
      expect(def.paths.length).toBeGreaterThan(0);
    }
    expect(getGroupIcon('blueprint')?.label).toBe('蓝图');
    expect(getGroupIcon('missing-key')).toBeUndefined();
  });

  it('builds semantic sections with separators, checked flag, and hover previews', () => {
    const picked: (string | undefined)[] = [];
    const previewed: (string | undefined)[] = [];
    const items = buildGroupIconMenuItems(
      'vector',
      '#0078D4',
      (k) => picked.push(k),
      (k) => previewed.push(k),
    );

    // 4 separators between the 5 semantic blocks
    const seps = items.filter((i) => i.separator);
    expect(seps).toHaveLength(4);

    // Only the active 'vector' item is checked
    const checkedItems = items.filter((i) => i.checked);
    expect(checkedItems).toHaveLength(1);
    expect(checkedItems[0].key).toBe('icon:vector');

    const defaultDot = items[0];
    expect(defaultDot.colorDot).toBe('#0078D4');
    defaultDot.onHover?.();
    defaultDot.action?.();
    expect(previewed).toEqual([undefined]);
    expect(picked).toEqual([undefined]);

    checkedItems[0].onHover?.();
    checkedItems[0].action?.();
    expect(previewed).toEqual([undefined, 'vector']);
    expect(picked).toEqual([undefined, 'vector']);
  });
});
