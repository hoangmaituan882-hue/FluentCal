import { describe, expect, it } from 'vitest';
import {
  BRAND_CATALOG,
  extractDomainFromQuery,
  extractDominantColorFromImageData,
  getBrandByKey,
  inferBrandFromTitle,
  searchLocalBrands,
} from './subscriptionIcons';

describe('subscriptionIcons built-in catalog & fuzzy brand search', () => {
  it('ships 55+ curated Chinese and global subscription brands with unique keys', () => {
    expect(BRAND_CATALOG.length).toBeGreaterThanOrEqual(55);
    const keys = new Set(BRAND_CATALOG.map((b) => b.key));
    expect(keys.size).toBe(BRAND_CATALOG.length);
  });

  it('matches Chinese and English brand aliases instantaneously', () => {
    expect(searchLocalBrands('gpt')[0]?.brandKey).toBe('chatgpt');
    expect(searchLocalBrands('b站')[0]?.brandKey).toBe('bilibili');
    expect(searchLocalBrands('网易云')[0]?.brandKey).toBe('netease-music');
    expect(searchLocalBrands('88vip')[0]?.brandKey).toBe('taobao-88vip');
    expect(searchLocalBrands('夸克')[0]?.brandKey).toBe('quark');
    expect(searchLocalBrands('美团')[0]?.brandKey).toBe('meituan');
    expect(searchLocalBrands('cursor')[0]?.brandKey).toBe('cursor');
  });

  it('auto-infers built-in brand from existing subscription titles', () => {
    expect(inferBrandFromTitle('ChatGPT Plus')?.key).toBe('chatgpt');
    expect(inferBrandFromTitle('B站大会员')?.key).toBe('bilibili');
    expect(inferBrandFromTitle('iCloud+ 2TB 家庭组')?.key).toBe('icloud');
    expect(inferBrandFromTitle('Spotify 家庭组')?.key).toBe('spotify');
    expect(inferBrandFromTitle('美团神会员')?.key).toBe('meituan');
    expect(inferBrandFromTitle('完全未知的神秘自建服务xyz')).toBeUndefined();
    expect(getBrandByKey('claude')?.brandColor).toBe('#D97757');
  });

  it('extracts valid domains from URLs and raw hostnames', () => {
    expect(extractDomainFromQuery('linear.app')).toBe('linear.app');
    expect(extractDomainFromQuery('https://cursor.com/pricing')).toBe('cursor.com');
    expect(extractDomainFromQuery('ChatGPT Plus')).toBeNull();
    expect(extractDomainFromQuery('哔哩哔哩')).toBeNull();
  });

  it('extracts dominant vibrant brand color while ignoring white/black/transparent backgrounds', () => {
    // 10 white pixels + 6 vibrant Spotify-green pixels + 4 transparent pixels
    const buf = new Uint8ClampedArray(20 * 4);
    for (let i = 0; i < 10; i++) {
      buf[i * 4] = 255;
      buf[i * 4 + 1] = 255;
      buf[i * 4 + 2] = 255;
      buf[i * 4 + 3] = 255;
    }
    for (let i = 10; i < 16; i++) {
      buf[i * 4] = 29;
      buf[i * 4 + 1] = 185;
      buf[i * 4 + 2] = 84;
      buf[i * 4 + 3] = 255;
    }
    for (let i = 16; i < 20; i++) {
      buf[i * 4 + 3] = 0;
    }
    expect(extractDominantColorFromImageData(buf)).toBe('#1DB954');
  });
});
