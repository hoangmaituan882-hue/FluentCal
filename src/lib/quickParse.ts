import type { Group, ISODate, TaskPriority } from '@/types';
import { addDays, weekday } from './date';

export interface ParsedQuickInput {
  cleanTitle: string;
  date?: ISODate;
  dateLabel?: string;
  time?: string;
  priority?: TaskPriority;
  groupId?: string;
  groupName?: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function nextWeekdayDate(today: ISODate, targetWd: number, forceNextWeek: boolean): ISODate {
  const cur = weekday(today);
  let delta = (targetWd - cur + 7) % 7;
  if (forceNextWeek) {
    delta = delta === 0 ? 7 : delta + 7;
  } else if (delta === 0) {
    delta = 7;
  }
  return addDays(today, delta);
}

/**
 * Lightweight deterministic natural-language parser for quick task capture.
 * Recognizes:
 * - Date: 今天 / 明天 / 后天 / 大后天 / 周一..周日 / 下周一..下周日
 * - Time: 09:30 / 15:00 / 上午9点 / 下午3点半 / 晚上8点
 * - Priority: !紧急 / !高 / !中 / !低 / !high / !urgent
 * - Group: #分组名 (matches existing workspace groups by substring)
 */
export function parseQuickTaskInput(
  raw: string,
  today: ISODate,
  groups: Group[],
): ParsedQuickInput {
  let text = raw.trim();
  if (!text) return { cleanTitle: '' };

  let date: ISODate | undefined;
  let dateLabel: string | undefined;
  let time: string | undefined;
  let priority: TaskPriority | undefined;
  let groupId: string | undefined;
  let groupName: string | undefined;

  // 1. Group tag (#name)
  text = text.replace(/(?:^|\s)#([^\s#]+)/g, (full, tag: string) => {
    const lower = tag.toLowerCase();
    const match = groups.find(
      (g) => g.name.toLowerCase() === lower || g.name.toLowerCase().includes(lower),
    );
    if (match) {
      groupId = match.id;
      groupName = match.name;
      return ' ';
    }
    return full;
  });

  // 2. Priority (!紧急 / !高 / !中 / !低 / !urgent / !high)
  text = text.replace(/(?:^|\s)[!！](紧急|高|中|低|urgent|high|medium|low)/gi, (_full, token: string) => {
    const t = token.toLowerCase();
    if (t === '紧急' || t === 'urgent') priority = 'urgent';
    else if (t === '高' || t === 'high') priority = 'high';
    else if (t === '中' || t === 'medium') priority = 'medium';
    else if (t === '低' || t === 'low') priority = 'low';
    return ' ';
  });

  // 3. Date keywords
  const dateMatchers: [RegExp, () => { d: ISODate; l: string }][] = [
    [/(?:^|\s)大后天(?=\s|$|上|下|晚|中|\d)/, () => ({ d: addDays(today, 3), l: '大后天' })],
    [/(?:^|\s)后天(?=\s|$|上|下|晚|中|\d)/, () => ({ d: addDays(today, 2), l: '后天' })],
    [/(?:^|\s)明天(?=\s|$|上|下|晚|中|\d)/, () => ({ d: addDays(today, 1), l: '明天' })],
    [/(?:^|\s)今天(?=\s|$|上|下|晚|中|\d)/, () => ({ d: today, l: '今天' })],
  ];
  for (const [re, resolver] of dateMatchers) {
    if (re.test(text)) {
      const res = resolver();
      date = res.d;
      dateLabel = res.l;
      text = text.replace(re, ' ');
      break;
    }
  }

  if (!date) {
    const wdRe = /(?:^|\s)(下)?(?:周|星期)([一二三四五六日天])(?=\s|$|上|下|晚|中|\d)/;
    const m = text.match(wdRe);
    if (m) {
      const isNext = !!m[1];
      const wdChar = m[2];
      const targetWd = WEEKDAY_MAP[wdChar];
      if (targetWd !== undefined) {
        date = nextWeekdayDate(today, targetWd, isNext);
        dateLabel = `${isNext ? '下' : ''}周${wdChar}`;
        text = text.replace(wdRe, ' ');
      }
    }
  }

  // 4. Time expressions: "下午3点半", "上午9点", "晚上8点15", "14:30"
  const cnTimeRe = /(?:^|\s)(上午|早上|中午|下午|晚上)?(\d{1,2})点(?:(半)|(\d{1,2})分?)?(?=\s|$)/;
  const cnM = text.match(cnTimeRe);
  if (cnM) {
    const period = cnM[1] || '';
    let hr = Number(cnM[2]);
    const min = cnM[3] ? 30 : cnM[4] ? Number(cnM[4]) : 0;
    if ((period === '下午' || period === '晚上') && hr < 12) hr += 12;
    if (period === '中午' && hr < 11) hr += 12;
    if (hr >= 0 && hr <= 23 && min >= 0 && min <= 59) {
      time = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      text = text.replace(cnTimeRe, ' ');
    }
  } else {
    const hhmmRe = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/;
    const hm = text.match(hhmmRe);
    if (hm) {
      time = `${String(Number(hm[1])).padStart(2, '0')}:${hm[2]}`;
      text = text.replace(hhmmRe, ' ');
    }
  }

  const cleanTitle = text.replace(/\s+/g, ' ').trim();
  return {
    cleanTitle: cleanTitle || raw.trim(),
    date,
    dateLabel,
    time,
    priority,
    groupId,
    groupName,
  };
}
