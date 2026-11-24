import type { SubscriptionCategory } from '@/types';

export interface BrandCatalogItem {
  key: string;
  name: string;
  aliases: string[];
  brandColor: string;
  category: SubscriptionCategory;
  watermark: string;
  emblem: string;
  domain?: string;
  /** Clean single-color geometric SVG path(s) in 24x24 viewBox (rendered crisp white on brandColor). */
  svgPaths?: string[];
  /** True when `svgPaths` should be rendered as clean vector strokes rather than solid fills. */
  svgStroke?: boolean;
  /** Optional stylized monogram text for Chinese/typographic brands (e.g. '88', 'WPS', '美'). */
  glyphText?: string;
}

export interface IconSearchCandidate {
  id: string;
  source: 'local' | 'appstore' | 'iconify' | 'favicon';
  name: string;
  subtitle?: string;
  brandKey?: string;
  brandColor?: string;
  category?: SubscriptionCategory;
  watermark?: string;
  emblem?: string;
  /** Preview URL (https://...) or inline data URL for live search strip */
  previewUrl?: string;
  /** Iconify identifier (e.g. 'simple-icons:cloudflare') */
  iconifyId?: string;
  /** True when candidate is a monochrome Iconify icon that should be tinted white on brandColor */
  monochrome?: boolean;
}

export interface MaterializedIconResult {
  brandKey?: string;
  iconData?: string;
  brandColor?: string;
  category?: SubscriptionCategory;
  watermark?: string;
  emblem?: string;
}

/**
 * Tier 1 Curated Offline Brand Catalog (60+ high-frequency Global + Chinese subscription services).
 * Zero external bundle bloat, 0ms instant matching, works offline across Windows / Android / Web.
 */
export const BRAND_CATALOG: BrandCatalogItem[] = [
  // ── AI & Developer Tools ──────────────────────────────────────────────────
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    aliases: ['chatgpt', 'openai', 'gpt', 'gpt plus', 'chatgpt plus', 'o1', 'o3'],
    brandColor: '#10A37F',
    category: 'ai',
    watermark: 'ChatGPT',
    emblem: '✦',
    domain: 'chatgpt.com',
    svgPaths: [
      'M12 3.2c1.9 0 3.5 1.1 4.2 2.7 1.7.3 3.1 1.7 3.3 3.5.2 1.4-.4 2.7-1.4 3.6.7 1.5.5 3.3-.6 4.6-1.1 1.3-2.9 1.7-4.4 1.1-.8 1.2-2.2 2.1-3.8 2.1-1.9 0-3.5-1.1-4.2-2.7-1.7-.3-3.1-1.7-3.3-3.5-.2-1.4.4-2.7 1.4-3.6-.7-1.5-.5-3.3.6-4.6 1.1-1.3 2.9-1.7 4.4-1.1.8-1.2 2.2-2.1 3.8-2.1Zm0 4.6L8.4 9.9v4.2L12 16.2l3.6-2.1V9.9L12 7.8Z',
    ],
  },
  {
    key: 'claude',
    name: 'Claude',
    aliases: ['claude', 'anthropic', 'claude pro', 'claude max', '克劳德'],
    brandColor: '#D97757',
    category: 'ai',
    watermark: 'Claude',
    emblem: '✴',
    domain: 'claude.ai',
    svgPaths: [
      'M12 2.5 13.6 9.1 19.6 5.4 14.9 10.9 21.5 12 14.9 13.1 19.6 18.6 13.6 14.9 12 21.5 10.4 14.9 4.4 18.6 9.1 13.1 2.5 12 9.1 10.9 4.4 5.4 10.4 9.1Z',
    ],
  },
  {
    key: 'gemini',
    name: 'Gemini',
    aliases: ['gemini', 'google ai', 'bard', 'google one ai', '双子座'],
    brandColor: '#4285F4',
    category: 'ai',
    watermark: 'Gemini',
    emblem: '✦',
    domain: 'gemini.google.com',
    svgPaths: ['M12 2.2c.8 5.2 4.6 9 9.8 9.8-5.2.8-9 4.6-9.8 9.8-.8-5.2-4.6-9-9.8-9.8 5.2-.8 9-4.6 9.8-9.8Z'],
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    aliases: ['deepseek', '深度求索', 'ds'],
    brandColor: '#4D6BFE',
    category: 'ai',
    watermark: 'DeepSeek',
    emblem: 'D',
    domain: 'deepseek.com',
    svgPaths: [
      'M4.5 13.5c0-4.4 3.4-7.8 8-7.8 3.8 0 6.8 2.2 7.3 5.5-.9-.6-2-.8-3-.5-.8.2-1.2.9-1.9 1.3-1.4.8-3.4.5-4.3-.7-.4.9-.2 2.1.6 2.8 1.2 1 3.1 1.2 4.7.6-.8 2.2-3 3.6-5.7 3.6-3.4 0-5.7-2-5.7-4.8Z',
    ],
  },
  {
    key: 'kimi',
    name: 'Kimi',
    aliases: ['kimi', '月之暗面', 'moonshot'],
    brandColor: '#17171A',
    category: 'ai',
    watermark: 'Kimi',
    emblem: 'K',
    domain: 'kimi.moonshot.cn',
    glyphText: 'Kimi',
  },
  {
    key: 'cursor',
    name: 'Cursor',
    aliases: ['cursor', 'cursor pro', 'ai ide'],
    brandColor: '#18181B',
    category: 'ai',
    watermark: 'Cursor',
    emblem: '▷',
    domain: 'cursor.com',
    svgPaths: ['M12 2.5 20.5 7.4v9.2L12 21.5 3.5 16.6V7.4L12 2.5Zm0 3.1L6.6 8.8 12 12l5.4-3.2L12 5.6Zm1.2 8.2v4.6l4.6-2.7v-4.5l-4.6 2.6Z'],
  },
  {
    key: 'github',
    name: 'GitHub',
    aliases: ['github', 'copilot', 'github copilot', 'github pro'],
    brandColor: '#24292F',
    category: 'work',
    watermark: 'GitHub',
    emblem: '⌘',
    domain: 'github.com',
    svgPaths: [
      'M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.6-.2.6-.5v-1.7c-2.5.5-3-1.1-3-1.1-.4-1-1-1.3-1-1.3-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.7.8.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.4 0-1 .4-1.8.9-2.4-.1-.2-.4-1.1.1-2.4 0 0 .8-.2 2.5.9a8.7 8.7 0 0 1 4.6 0c1.7-1.1 2.5-.9 2.5-.9.5 1.3.2 2.2.1 2.4.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.7v2.5c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z',
    ],
  },
  {
    key: 'midjourney',
    name: 'Midjourney',
    aliases: ['midjourney', 'mj', '绘图'],
    brandColor: '#1E293B',
    category: 'ai',
    watermark: 'Midjourney',
    emblem: '⛵',
    domain: 'midjourney.com',
    svgPaths: ['M12 4.2 5.2 15.8h6.2L12 4.2Zm1.4 3.4v8.2h5.4L13.4 7.6ZM4 17.5h16l-1.8 2.3H5.8L4 17.5Z'],
  },
  {
    key: 'perplexity',
    name: 'Perplexity',
    aliases: ['perplexity', 'pplx', 'perplexity pro'],
    brandColor: '#1FB8CD',
    category: 'ai',
    watermark: 'Perplexity',
    emblem: '✳',
    domain: 'perplexity.ai',
    svgStroke: true,
    svgPaths: ['M12 3v18M4.5 7.5 12 12l7.5-4.5M4.5 16.5 12 12l7.5 4.5M7 4.8v5.5M17 4.8v5.5'],
  },
  {
    key: 'grok',
    name: 'Grok',
    aliases: ['grok', 'supergrok', 'xai', 'x.ai', 'x premium'],
    brandColor: '#141416',
    category: 'ai',
    watermark: 'Grok',
    emblem: 'G',
    domain: 'grok.com',
    svgStroke: true,
    svgPaths: ['M17.5 7.2A7.5 7.5 0 1 0 19.2 13H12.5M14.5 4.5 19.5 4.5 9.2 19.5'],
  },
  {
    key: 'windsurf',
    name: 'Windsurf',
    aliases: ['windsurf', 'codeium', 'windsurf pro'],
    brandColor: '#09B6A2',
    category: 'ai',
    watermark: 'Windsurf',
    emblem: 'W',
    domain: 'windsurf.com',
    svgStroke: true,
    svgPaths: ['M4.5 15.5c2.2-6.5 5-9.5 7.5-9.5s2.5 4 4.5 4c1.6 0 2.6-1.5 3-3.5M5.5 18.5c2.5-2.5 5-3.5 7.5-2.5s4.5 1 6.5-1.5'],
  },
  {
    key: 'poe',
    name: 'Poe',
    aliases: ['poe', 'quora poe', 'poe ai'],
    brandColor: '#5B47D6',
    category: 'ai',
    watermark: 'Poe',
    emblem: 'P',
    domain: 'poe.com',
    glyphText: 'Poe',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    aliases: ['openrouter', 'api', 'llm api', '硅基流动', 'siliconflow'],
    brandColor: '#6366F1',
    category: 'ai',
    watermark: 'OpenRouter',
    emblem: '⇄',
    domain: 'openrouter.ai',
    svgStroke: true,
    svgPaths: ['M4.5 8h9.5l-2.8-2.8M19.5 16H10l2.8 2.8M4.5 16h2.5M17 8h2.5'],
  },
  {
    key: 'doubao',
    name: '豆包',
    aliases: ['豆包', 'doubao', '字节ai', 'coze', '扣子'],
    brandColor: '#2B6BFF',
    category: 'ai',
    watermark: '豆包',
    emblem: '豆',
    domain: 'doubao.com',
    glyphText: '豆包',
  },
  {
    key: 'qwen',
    name: '通义千问',
    aliases: ['通义', '通义千问', 'qwen', '千问'],
    brandColor: '#624AFF',
    category: 'ai',
    watermark: '通义千问',
    emblem: '千',
    domain: 'tongyi.aliyun.com',
    glyphText: '千问',
  },
  {
    key: 'suno',
    name: 'Suno',
    aliases: ['suno', 'suno ai', 'ai音乐'],
    brandColor: '#E11D48',
    category: 'ai',
    watermark: 'Suno',
    emblem: '♪',
    domain: 'suno.com',
    svgPaths: ['M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm-2.5 5.8 6.5 3.2-6.5 3.2V8.8Z'],
  },
  {
    key: 'notion',
    name: 'Notion',
    aliases: ['notion', 'notion plus', 'notion ai', '笔记'],
    brandColor: '#1C1B19',
    category: 'work',
    watermark: 'Notion',
    emblem: 'N',
    domain: 'notion.so',
    glyphText: 'N',
  },
  {
    key: 'figma',
    name: 'Figma',
    aliases: ['figma', 'figma pro', 'figjam'],
    brandColor: '#A259FF',
    category: 'work',
    watermark: 'Figma',
    emblem: 'F',
    domain: 'figma.com',
    svgPaths: [
      'M8.5 3.5h3.5v5.5H8.5a2.75 2.75 0 1 1 0-5.5Zm3.5 0h3.5a2.75 2.75 0 1 1 0 5.5H12V3.5Zm0 5.5h3.5a2.75 2.75 0 1 1 0 5.5H12V9Zm-3.5 0H12v5.5H8.5a2.75 2.75 0 1 1 0-5.5Zm0 5.5H12v3a2.75 2.75 0 1 1-3.5-3Z',
    ],
  },
  {
    key: 'linear',
    name: 'Linear',
    aliases: ['linear', 'linear app'],
    brandColor: '#5E6AD2',
    category: 'work',
    watermark: 'Linear',
    emblem: 'L',
    domain: 'linear.app',
    svgPaths: ['M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9Zm-5.8 9.6 5.2 5.2a7 7 0 0 1-5.2-5.2Zm1.4-2.9 6.7 6.7c-.4.3-.9.5-1.4.7L6.9 11.1c.2-.5.4-1 .7-1.4Zm2.2-2.2 6.7 6.7c-.3.4-.6.8-1 1.1L8.7 8.5c.3-.4.7-.7 1.1-1Z'],
  },
  {
    key: 'vercel',
    name: 'Vercel',
    aliases: ['vercel', 'vercel pro', 'nextjs'],
    brandColor: '#111111',
    category: 'cloud',
    watermark: 'Vercel',
    emblem: '▲',
    domain: 'vercel.com',
    svgPaths: ['M12 4.2 21 19.5H3L12 4.2Z'],
  },
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    aliases: ['cloudflare', 'cf', 'r2', 'workers'],
    brandColor: '#F38020',
    category: 'cloud',
    watermark: 'Cloudflare',
    emblem: '☁',
    domain: 'cloudflare.com',
    svgPaths: ['M7.2 17.5h10.2a3.3 3.3 0 0 0 .5-6.5A5.3 5.3 0 0 0 7.7 9.6a4 4 0 0 0-.5 7.9Z'],
  },
  {
    key: 'aws',
    name: 'AWS',
    aliases: ['aws', 'amazon web services', '亚马逊云', 'ec2'],
    brandColor: '#FF9900',
    category: 'cloud',
    watermark: 'AWS',
    emblem: 'A',
    domain: 'aws.amazon.com',
    glyphText: 'AWS',
  },
  {
    key: 'aliyun',
    name: '阿里云',
    aliases: ['阿里云', 'aliyun', 'alibaba cloud', 'ecs', 'oss'],
    brandColor: '#FF6A00',
    category: 'cloud',
    watermark: 'Aliyun',
    emblem: '云',
    domain: 'aliyun.com',
    glyphText: '阿里',
  },
  {
    key: 'tencent-cloud',
    name: '腾讯云',
    aliases: ['腾讯云', 'tencent cloud', 'qcloud', '轻量服务器'],
    brandColor: '#0052D9',
    category: 'cloud',
    watermark: 'QCloud',
    emblem: '云',
    domain: 'cloud.tencent.com',
    svgPaths: ['M7.5 17.5h9.4a3.6 3.6 0 0 0 .6-7.1A5.2 5.2 0 0 0 7.7 9.3a4.1 4.1 0 0 0-.2 8.2Z'],
  },
  {
    key: 'vps',
    name: '云服务器 VPS',
    aliases: ['vps', 'server', 'linux', '云服务器', '服务器', '搬瓦工', 'vultr', 'digitalocean', 'hetzner', '甲骨文'],
    brandColor: '#0EA5E9',
    category: 'cloud',
    watermark: 'Server',
    emblem: '⌘',
    svgStroke: true,
    svgPaths: ['M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-3Zm0 8a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-3ZM8 8h1.5M8 16h1.5'],
  },
  {
    key: 'jetbrains',
    name: 'JetBrains',
    aliases: ['jetbrains', 'intellij', 'idea', 'webstorm', 'pycharm', 'goland'],
    brandColor: '#000000',
    category: 'work',
    watermark: 'JetBrains',
    emblem: 'JB',
    domain: 'jetbrains.com',
    glyphText: 'JB',
  },
  {
    key: '1password',
    name: '1Password',
    aliases: ['1password', '1p', '密码管理'],
    brandColor: '#0572EC',
    category: 'work',
    watermark: '1Password',
    emblem: '1P',
    domain: '1password.com',
    svgPaths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6Zm-1.1 2.4v6.8h2.2V8.6h-2.2Z'],
  },
  {
    key: 'bitwarden',
    name: 'Bitwarden',
    aliases: ['bitwarden', 'bw', '密码'],
    brandColor: '#175DDC',
    category: 'work',
    watermark: 'Bitwarden',
    emblem: 'B',
    domain: 'bitwarden.com',
    svgPaths: ['M12 3 5 5.6v5.8c0 4.5 3 8.1 7 9.6 4-1.5 7-5.1 7-9.6V5.6L12 3Zm0 2.4 4.6 1.7v4.3c0 3.1-1.9 5.8-4.6 7V5.4Z'],
  },
  {
    key: 'tailscale',
    name: 'Tailscale',
    aliases: ['tailscale', 'ts', '组网', '内网穿透'],
    brandColor: '#242424',
    category: 'cloud',
    watermark: 'Tailscale',
    emblem: '::: ',
    domain: 'tailscale.com',
    svgPaths: [
      'M6.5 6.5a1.5 1.5 0 1 0 0 .01M12 6.5a1.5 1.5 0 1 0 0 .01M17.5 6.5a1.5 1.5 0 1 0 0 .01M6.5 12a1.7 1.7 0 1 0 0 .01M12 12a1.7 1.7 0 1 0 0 .01M17.5 12a1.7 1.7 0 1 0 0 .01M12 17.5a1.7 1.7 0 1 0 0 .01',
    ],
  },
  {
    key: 'raycast',
    name: 'Raycast',
    aliases: ['raycast', 'raycast pro'],
    brandColor: '#FF6363',
    category: 'work',
    watermark: 'Raycast',
    emblem: 'R',
    domain: 'raycast.com',
    svgStroke: true,
    svgPaths: ['M6.5 17.5 17.5 6.5M11.5 6.5h6v6M6.5 12.5v5h5'],
  },

  // ── Media, Music & Reading ────────────────────────────────────────────────
  {
    key: 'apple-music',
    name: 'Apple Music',
    aliases: ['apple music', 'applemusic', '苹果音乐', 'am'],
    brandColor: '#FA243C',
    category: 'media',
    watermark: 'Apple Music',
    emblem: '♫',
    domain: 'music.apple.com',
    svgPaths: ['M17.5 4.2v11.1a2.8 2.8 0 1 1-1.6-2.5V8.1l-6.3 1.4v7.3a2.8 2.8 0 1 1-1.6-2.5V6.6l9.5-2.4Z'],
  },
  {
    key: 'spotify',
    name: 'Spotify',
    aliases: ['spotify', '声田', '声破天', 'spotify family', 'spotify 家庭组'],
    brandColor: '#1DB954',
    category: 'media',
    watermark: 'Spotify',
    emblem: '♪',
    domain: 'spotify.com',
    svgPaths: [
      'M6.2 9.4c3.6-1.1 8.5-.9 11.7.7.4.2.6.7.4 1.1-.2.4-.7.6-1.1.4-2.8-1.4-7.2-1.6-10.5-.6-.4.1-.9-.1-1-.6-.1-.4.1-.9.5-1Zm.9 3.4c2.9-.8 6.8-.6 9.4.7.4.2.5.6.3 1-.2.3-.6.5-1 .3-2.2-1.1-5.7-1.3-8.3-.5-.4.1-.8-.1-.9-.5-.1-.4.1-.9.5-1Zm.8 3.2c2.2-.6 5.2-.4 7.2.6.3.2.4.5.2.8-.2.3-.5.4-.8.2-1.7-.9-4.3-1-6.2-.5-.3.1-.7-.1-.8-.4-.1-.3.1-.6.4-.7Z',
    ],
  },
  {
    key: 'youtube',
    name: 'YouTube Premium',
    aliases: ['youtube', 'yt', 'ytb', '油管', 'youtube premium', 'youtube music'],
    brandColor: '#FF0000',
    category: 'media',
    watermark: 'YouTube',
    emblem: '▶',
    domain: 'youtube.com',
    svgPaths: ['M20.5 8.1a2.5 2.5 0 0 0-1.8-1.8C17.1 5.9 12 5.9 12 5.9s-5.1 0-6.7.4a2.5 2.5 0 0 0-1.8 1.8C3.1 9.7 3.1 12 3.1 12s0 2.3.4 3.9a2.5 2.5 0 0 0 1.8 1.8c1.6.4 6.7.4 6.7.4s5.1 0 6.7-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-3.9.4-3.9s0-2.3-.4-3.9ZM10.2 14.8V9.2L15 12l-4.8 2.8Z'],
  },
  {
    key: 'netflix',
    name: 'Netflix',
    aliases: ['netflix', '奈飞', '网飞', 'nf'],
    brandColor: '#E50914',
    category: 'media',
    watermark: 'Netflix',
    emblem: 'N',
    domain: 'netflix.com',
    svgPaths: ['M6.5 4h3.2l4.6 10.6V4h3.2v16h-3.1L9.7 9.4V20H6.5V4Z'],
  },
  {
    key: 'disney',
    name: 'Disney+',
    aliases: ['disney', 'disney+', '迪士尼', 'disney plus'],
    brandColor: '#113CCF',
    category: 'media',
    watermark: 'Disney+',
    emblem: 'D+',
    domain: 'disneyplus.com',
    glyphText: 'D+',
  },
  {
    key: 'bilibili',
    name: 'B站大会员',
    aliases: ['b站', 'bilibili', 'bili', '哔哩哔哩', '大会员', '小破站'],
    brandColor: '#FB7299',
    category: 'media',
    watermark: 'Bilibili',
    emblem: 'B',
    domain: 'bilibili.com',
    svgPaths: [
      'M7.8 4.2 10 6.5h4l2.2-2.3a.8.8 0 0 1 1.2 1.1l-1.1 1.2h1.9A2.8 2.8 0 0 1 21 9.3v7.9a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2V9.3a2.8 2.8 0 0 1 2.8-2.8h1.9L6.6 5.3a.8.8 0 0 1 1.2-1.1ZM6 9a1 1 0 0 0-1 1v6.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H6Zm2.7 2.8a1 1 0 0 1 1 1v1.4a1 1 0 1 1-2 0v-1.4a1 1 0 0 1 1-1Zm6.6 0a1 1 0 0 1 1 1v1.4a1 1 0 1 1-2 0v-1.4a1 1 0 0 1 1-1Z',
    ],
  },
  {
    key: 'netease-music',
    name: '网易云音乐',
    aliases: ['网易云', '网易云音乐', '云音乐', '黑胶', 'netease', 'wyy'],
    brandColor: '#D43C33',
    category: 'media',
    watermark: 'NetEase',
    emblem: '♫',
    domain: 'music.163.com',
    svgPaths: ['M12 4.2a7.8 7.8 0 1 0 7.7 9.1c.1-.7-.4-1.3-1.1-1.3-.6 0-1 .4-1.2 1a5.5 5.5 0 1 1-4.8-6.4l-.8 3.2a2.6 2.6 0 1 0 2 2.5c0-.3 0-.6-.1-.8l1.2-4.7c1.6.4 2.7 1.3 3.3 2.5.3.6 1 .8 1.6.5.6-.3.8-1 .5-1.6A7.8 7.8 0 0 0 12 4.2Z'],
  },
  {
    key: 'qq-music',
    name: 'QQ音乐',
    aliases: ['qq音乐', 'qqmusic', '绿钻', '豪华绿钻'],
    brandColor: '#12B76A',
    category: 'media',
    watermark: 'QQ Music',
    emblem: '♪',
    domain: 'y.qq.com',
    svgPaths: ['M15.8 4.8v9.8a3.2 3.2 0 1 1-1.9-2.9V7.8l-5.2 1.2v6.6a3.2 3.2 0 1 1-1.9-2.9V6.8l9-2Z'],
  },
  {
    key: 'iqiyi',
    name: '爱奇艺',
    aliases: ['爱奇艺', 'iqiyi', '黄金会员', '星钻'],
    brandColor: '#00BE06',
    category: 'media',
    watermark: 'iQIYI',
    emblem: 'Q',
    domain: 'iqiyi.com',
    glyphText: 'iQ',
  },
  {
    key: 'tencent-video',
    name: '腾讯视频',
    aliases: ['腾讯视频', 'tencent video', 'v.qq', '超级影视', '极光tv'],
    brandColor: '#FF6B00',
    category: 'media',
    watermark: 'TencentTV',
    emblem: '▶',
    domain: 'v.qq.com',
    svgPaths: ['M8 6.2 18.2 12 8 17.8V6.2Z'],
  },
  {
    key: 'youku',
    name: '优酷 VIP',
    aliases: ['优酷', 'youku', '酷喵'],
    brandColor: '#00A0E9',
    category: 'media',
    watermark: 'Youku',
    emblem: '优',
    domain: 'youku.com',
    glyphText: '优酷',
  },
  {
    key: 'mango-tv',
    name: '芒果TV',
    aliases: ['芒果', '芒果tv', 'mgtv', 'mangotv'],
    brandColor: '#FF7D00',
    category: 'media',
    watermark: 'MangoTV',
    emblem: '芒',
    domain: 'mgtv.com',
    glyphText: '芒果',
  },
  {
    key: 'ximalaya',
    name: '喜马拉雅',
    aliases: ['喜马拉雅', 'ximalaya', '听书'],
    brandColor: '#F86442',
    category: 'media',
    watermark: 'Ximalaya',
    emblem: '喜',
    domain: 'ximalaya.com',
    glyphText: '喜',
  },
  {
    key: 'weread',
    name: '微信读书',
    aliases: ['微信读书', 'weread', '读书', '付费会员'],
    brandColor: '#2B84F0',
    category: 'media',
    watermark: 'WeRead',
    emblem: '读',
    domain: 'weread.qq.com',
    svgPaths: ['M4.5 6.2A2.2 2.2 0 0 1 6.7 4H11v15.5H6.7a2.2 2.2 0 0 1-2.2-2.2V6.2ZM13 4h4.3a2.2 2.2 0 0 1 2.2 2.2v11.1a2.2 2.2 0 0 1-2.2 2.2H13V4Z'],
  },
  {
    key: 'xiaoyuzhou',
    name: '小宇宙',
    aliases: ['小宇宙', 'xiaoyuzhou', '播客', 'podcast'],
    brandColor: '#26A5FF',
    category: 'media',
    watermark: 'Podcast',
    emblem: '◎',
    domain: 'xiaoyuzhoufm.com',
    svgStroke: true,
    svgPaths: ['M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM3.2 14.5c2.2 1.2 15.4-3.8 17.6-5'],
  },

  // ── Cloud Storage & Productivity ──────────────────────────────────────────
  {
    key: 'icloud',
    name: 'iCloud+',
    aliases: ['icloud', 'icloud+', '苹果云', 'apple icloud'],
    brandColor: '#2563EB',
    category: 'cloud',
    watermark: 'iCloud+',
    emblem: '☁',
    domain: 'icloud.com',
    svgPaths: ['M7.4 17.6h9.6a3.5 3.5 0 0 0 .6-6.9 5.3 5.3 0 0 0-10.1-1.3A4 4 0 0 0 7.4 17.6Z'],
  },
  {
    key: 'apple-one',
    name: 'Apple One',
    aliases: ['apple one', 'appleone', 'apple tv', 'apple arcade', 'apple'],
    brandColor: '#1D1D1F',
    category: 'media',
    watermark: 'Apple',
    emblem: '',
    domain: 'apple.com',
    svgPaths: ['M15.2 6.4c.7-.9 1.1-2 1-3.2-1 .1-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.5 2.9-1.3Zm1.4 6.2c0-1.9 1.5-2.8 1.6-2.9-.9-1.3-2.3-1.5-2.8-1.5-1.2-.1-2.3.7-2.9.7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2 1 0 1.4-.6 2.6-.6 1.2 0 1.5.6 2.6.6 1.1 0 1.8-1 2.4-1.9.8-1.1 1.1-2.2 1.1-2.3 0-.1-2.2-.8-2.2-3.4Z'],
  },
  {
    key: 'google-one',
    name: 'Google One',
    aliases: ['google one', 'google drive', 'google', '谷歌云盘'],
    brandColor: '#1A73E8',
    category: 'cloud',
    watermark: 'Google',
    emblem: 'G',
    domain: 'one.google.com',
    glyphText: 'G',
  },
  {
    key: 'microsoft365',
    name: 'Microsoft 365',
    aliases: ['microsoft', 'microsoft 365', 'office', 'office 365', 'onedrive', '微软', 'm365'],
    brandColor: '#0078D4',
    category: 'work',
    watermark: 'Office 365',
    emblem: '⊞',
    domain: 'microsoft.com',
    svgPaths: ['M4 4h7.3v7.3H4V4Zm8.7 0H20v7.3h-7.3V4ZM4 12.7h7.3V20H4v-7.3Zm8.7 0H20V20h-7.3v-7.3Z'],
  },
  {
    key: 'wps',
    name: 'WPS 超级会员',
    aliases: ['wps', '金山', 'wps会员', '稻壳'],
    brandColor: '#E53935',
    category: 'work',
    watermark: 'WPS',
    emblem: 'W',
    domain: 'wps.cn',
    glyphText: 'WPS',
  },
  {
    key: 'baidu-pan',
    name: '百度网盘',
    aliases: ['百度网盘', 'baidu', '度盘', '百度云', 'svip'],
    brandColor: '#06A7FF',
    category: 'cloud',
    watermark: 'BaiduPan',
    emblem: '盘',
    domain: 'pan.baidu.com',
    glyphText: '度盘',
  },
  {
    key: 'quark',
    name: '夸克网盘',
    aliases: ['夸克', 'quark', '夸克网盘', '夸克扫描王'],
    brandColor: '#3B66FF',
    category: 'cloud',
    watermark: 'Quark',
    emblem: '夸',
    domain: 'pan.quark.cn',
    glyphText: '夸克',
  },
  {
    key: 'aliyun-drive',
    name: '阿里云盘',
    aliases: ['阿里云盘', 'aliyundrive', 'alipan'],
    brandColor: '#6366F1',
    category: 'cloud',
    watermark: 'AliPan',
    emblem: '云',
    domain: 'alipan.com',
    svgPaths: ['M6.5 16.8h11a3.2 3.2 0 0 0 .5-6.3 5 5 0 0 0-9.6-1.1 3.7 3.7 0 0 0-1.9 7.4Z'],
  },
  {
    key: 'xunlei',
    name: '迅雷超级会员',
    aliases: ['迅雷', 'xunlei', '雷'],
    brandColor: '#0088FF',
    category: 'cloud',
    watermark: 'Xunlei',
    emblem: '⚡',
    domain: 'xunlei.com',
    svgPaths: ['M13.6 3 5.5 13.4h5.6L10.4 21l8.1-10.4h-5.6L13.6 3Z'],
  },
  {
    key: 'dropbox',
    name: 'Dropbox',
    aliases: ['dropbox', 'dbx'],
    brandColor: '#0061FF',
    category: 'cloud',
    watermark: 'Dropbox',
    emblem: '❖',
    domain: 'dropbox.com',
    svgPaths: ['M7.8 4.2 3 7.4l4.8 3.1 4.2-2.7-4.2-3.6Zm8.4 0L12 7.8l4.2 2.7L21 7.4l-4.8-3.2ZM3 13.7l4.8 3.1 4.2-2.8-4.2-3.5L3 13.7Zm13.2-3.2L12 14l4.2 2.8 4.8-3.1-4.8-3.2Z'],
  },
  {
    key: 'obsidian',
    name: 'Obsidian Sync',
    aliases: ['obsidian', 'ob', '黑曜石'],
    brandColor: '#7C3AED',
    category: 'work',
    watermark: 'Obsidian',
    emblem: '◆',
    domain: 'obsidian.md',
    svgPaths: ['M13.5 3.2 6.8 8.2 5.2 15.8l5.6 5 6.8-3.6 1.2-8.4-5.3-5.6Z'],
  },
  {
    key: 'adobe',
    name: 'Adobe Creative Cloud',
    aliases: ['adobe', 'photoshop', 'ps', 'lightroom', 'premiere', 'pr', 'cc'],
    brandColor: '#FA0F00',
    category: 'work',
    watermark: 'Adobe',
    emblem: 'A',
    domain: 'adobe.com',
    svgPaths: ['M14.5 4H20v16L14.5 4ZM9.5 4H4v16L9.5 4ZM12 10.2 15.5 20h-2.5l-1.1-3.1H9.3L12 10.2Z'],
  },
  {
    key: 'canva',
    name: 'Canva 可画',
    aliases: ['canva', '可画'],
    brandColor: '#00C4CC',
    category: 'work',
    watermark: 'Canva',
    emblem: 'C',
    domain: 'canva.com',
    glyphText: 'Canva',
  },
  {
    key: 'capcut',
    name: '剪映 VIP',
    aliases: ['剪映', 'capcut', '醒图'],
    brandColor: '#18181B',
    category: 'work',
    watermark: 'CapCut',
    emblem: '✂',
    domain: 'capcut.cn',
    glyphText: '剪映',
  },
  {
    key: 'feishu',
    name: '飞书',
    aliases: ['飞书', 'feishu', 'lark'],
    brandColor: '#00D6B9',
    category: 'work',
    watermark: 'Feishu',
    emblem: '飞',
    domain: 'feishu.cn',
    glyphText: '飞书',
  },
  {
    key: 'slack',
    name: 'Slack',
    aliases: ['slack'],
    brandColor: '#4A154B',
    category: 'work',
    watermark: 'Slack',
    emblem: '#',
    domain: 'slack.com',
    glyphText: '#',
  },
  {
    key: 'zoom',
    name: 'Zoom',
    aliases: ['zoom', '腾讯会议'],
    brandColor: '#0B5CFF',
    category: 'work',
    watermark: 'Zoom',
    emblem: 'Z',
    domain: 'zoom.us',
    svgPaths: ['M4.5 8.2A2.2 2.2 0 0 1 6.7 6h7.6a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V8.2Zm12.8 2.3 3.2-2.1v7.2l-3.2-2.1v-3Z'],
  },
  {
    key: 'telegram',
    name: 'Telegram Premium',
    aliases: ['telegram', 'tg', '电报', '纸飞机'],
    brandColor: '#26A5E4',
    category: 'work',
    watermark: 'Telegram',
    emblem: '✈',
    domain: 'telegram.org',
    svgPaths: ['M20.4 4.8 3.6 11.3c-.9.3-.9 1.6 0 1.9l4.1 1.4 1.6 4.7c.2.7 1.1.9 1.6.4l2.4-2.3 4.3 3.1c.6.4 1.5.1 1.7-.7l2.5-13.7c.2-.9-.7-1.6-1.4-1.3Z'],
  },
  {
    key: 'discord',
    name: 'Discord Nitro',
    aliases: ['discord', 'nitro', 'dc'],
    brandColor: '#5865F2',
    category: 'media',
    watermark: 'Discord',
    emblem: 'D',
    domain: 'discord.com',
    svgPaths: ['M18.6 6.2A14.4 14.4 0 0 0 15 5l-.4.8a13 13 0 0 0-5.2 0L9 5a14.4 14.4 0 0 0-3.6 1.2C3.1 9.6 2.5 13 2.8 16.3a14.6 14.6 0 0 0 4.4 2.2l.9-1.5a9.4 9.4 0 0 1-1.5-.7l.4-.3a10.4 10.4 0 0 0 10 0l.4.3c-.5.3-1 .5-1.5.7l.9 1.5a14.6 14.6 0 0 0 4.4-2.2c.4-3.8-.6-7.2-2.6-10.1ZM9.3 14.3c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Zm5.4 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z'],
  },
  {
    key: 'x',
    name: 'X Premium',
    aliases: ['x', 'twitter', '推特', 'x premium'],
    brandColor: '#111111',
    category: 'media',
    watermark: 'X',
    emblem: '𝕏',
    domain: 'x.com',
    svgPaths: ['M17.6 4h2.8l-6.1 7 7.2 9h-5.6l-4.4-5.7L6.5 20H3.7l6.5-7.4L3.3 4h5.7l4 5.2L17.6 4Z'],
  },

  // ── Life, Shopping, Delivery & Gaming ─────────────────────────────────────
  {
    key: 'meituan',
    name: '美团神会员',
    aliases: ['美团', 'meituan', '美团外卖', '神会员'],
    brandColor: '#F59E0B',
    category: 'life',
    watermark: 'Meituan',
    emblem: '美',
    domain: 'meituan.com',
    glyphText: '美团',
  },
  {
    key: 'taobao-88vip',
    name: '淘宝 88VIP',
    aliases: ['88vip', '淘宝', '天猫', 'taobao', 'tmall', '88'],
    brandColor: '#FF5000',
    category: 'life',
    watermark: '88VIP',
    emblem: '88',
    domain: 'taobao.com',
    glyphText: '88',
  },
  {
    key: 'jd-plus',
    name: '京东 PLUS',
    aliases: ['京东', 'jd', 'jd plus', '京东plus'],
    brandColor: '#E1251B',
    category: 'life',
    watermark: 'JD PLUS',
    emblem: '京',
    domain: 'jd.com',
    glyphText: '京东',
  },
  {
    key: 'eleme',
    name: '饿了么吃货卡',
    aliases: ['饿了么', 'eleme', '吃货卡'],
    brandColor: '#0095FF',
    category: 'life',
    watermark: 'Eleme',
    emblem: '饿',
    domain: 'ele.me',
    glyphText: '饿',
  },
  {
    key: 'hema',
    name: '盒马 X 会员',
    aliases: ['盒马', 'hema', '盒马鲜生'],
    brandColor: '#00B4FF',
    category: 'life',
    watermark: 'Hema',
    emblem: '盒',
    glyphText: '盒马',
  },
  {
    key: 'sams-club',
    name: '山姆会员',
    aliases: ['山姆', 'sams', 'sam', '山姆会员店'],
    brandColor: '#004B8D',
    category: 'life',
    watermark: 'Sams',
    emblem: '山',
    glyphText: '山姆',
  },
  {
    key: 'didi',
    name: '滴滴出行',
    aliases: ['滴滴', 'didi', '打车'],
    brandColor: '#FF7D00',
    category: 'life',
    watermark: 'DiDi',
    emblem: '滴',
    glyphText: '滴滴',
  },
  {
    key: 'steam',
    name: 'Steam',
    aliases: ['steam', '蒸汽', '游戏'],
    brandColor: '#1B2838',
    category: 'media',
    watermark: 'Steam',
    emblem: 'S',
    domain: 'steampowered.com',
    svgPaths: ['M12 3a9 9 0 0 0-8.9 7.8l4.7 1.9a2.8 2.8 0 0 1 1.7-.4l2.2-3.2a3.7 3.7 0 1 1 3.7 3.7h-.1l-3.1 2.2a2.8 2.8 0 0 1-5.4.8l-3.4-1.4A9 9 0 1 0 12 3Zm3.4 4.1a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
  },
  {
    key: 'playstation',
    name: 'PlayStation Plus',
    aliases: ['playstation', 'psn', 'ps plus', 'ps5', '索尼'],
    brandColor: '#003791',
    category: 'media',
    watermark: 'PS Plus',
    emblem: 'PS',
    domain: 'playstation.com',
    glyphText: 'PS',
  },
  {
    key: 'xbox',
    name: 'Xbox Game Pass',
    aliases: ['xbox', 'xgp', 'game pass', 'pgpass'],
    brandColor: '#107C10',
    category: 'media',
    watermark: 'Xbox',
    emblem: 'X',
    domain: 'xbox.com',
    svgStroke: true,
    svgPaths: ['M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8'],
  },
  {
    key: 'nintendo',
    name: 'Nintendo Switch Online',
    aliases: ['nintendo', 'switch', 'ns', '任天堂', 'nso'],
    brandColor: '#E60012',
    category: 'media',
    watermark: 'Nintendo',
    emblem: 'NS',
    domain: 'nintendo.com',
    glyphText: 'NS',
  },
  {
    key: 'duolingo',
    name: 'Duolingo Plus',
    aliases: ['duolingo', '多邻国', '多邻国super', 'super duolingo'],
    brandColor: '#58CC02',
    category: 'life',
    watermark: 'Duolingo',
    emblem: '🦉',
    domain: 'duolingo.com',
    glyphText: '多邻',
  },
];

const BRAND_BY_KEY = new Map<string, BrandCatalogItem>(BRAND_CATALOG.map((b) => [b.key, b]));

export function getBrandByKey(key?: string): BrandCatalogItem | undefined {
  if (!key) return undefined;
  return BRAND_BY_KEY.get(key);
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/[\s\-_+]+/g, ' ');
}

function scoreBrandMatch(item: BrandCatalogItem, normQuery: string, compactQuery: string): number {
  if (!normQuery) return 0;
  let best = 0;
  const targets = [item.key, item.name, item.watermark, ...item.aliases];

  for (const raw of targets) {
    const t = normalizeQuery(raw);
    const tc = t.replace(/\s+/g, '');
    if (!t) continue;
    if (t === normQuery || tc === compactQuery) {
      best = Math.max(best, 100);
    } else if (t.startsWith(normQuery) || tc.startsWith(compactQuery)) {
      best = Math.max(best, 85);
    } else if (normQuery.includes(t) && t.length >= 2) {
      best = Math.max(best, 78 + Math.min(12, t.length));
    } else if (t.includes(normQuery) && normQuery.length >= 2) {
      best = Math.max(best, 64);
    } else if (compactQuery.length >= 2 && tc.includes(compactQuery)) {
      best = Math.max(best, 58);
    }
  }
  return best;
}

const FEATURED_BRAND_KEYS = [
  'chatgpt',
  'claude',
  'apple-music',
  'spotify',
  'bilibili',
  'netease-music',
  'qq-music',
  'icloud',
  'meituan',
  'taobao-88vip',
  'jd-plus',
  'wps',
  'baidu-pan',
  'quark',
  'weread',
  'iqiyi',
  'tencent-video',
  'cursor',
  'github',
  'notion',
  'steam',
  'vps',
];

/** Curated default browseable icon library shown before the user types a search query. */
export function featuredLocalBrands(limit = 16): IconSearchCandidate[] {
  const out: IconSearchCandidate[] = [];
  for (const key of FEATURED_BRAND_KEYS) {
    const item = BRAND_BY_KEY.get(key);
    if (!item) continue;
    out.push({
      id: `local:${item.key}`,
      source: 'local',
      name: item.name,
      subtitle: '图标库',
      brandKey: item.key,
      brandColor: item.brandColor,
      category: item.category,
      watermark: item.name,
      emblem: item.emblem,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Instant 0ms offline search over curated built-in brands. */
export function searchLocalBrands(query: string, limit = 8): IconSearchCandidate[] {
  const norm = normalizeQuery(query);
  if (!norm) return [];
  const compact = norm.replace(/\s+/g, '');

  const scored: { item: BrandCatalogItem; score: number }[] = [];
  for (const item of BRAND_CATALOG) {
    const score = scoreBrandMatch(item, norm, compact);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  return scored.slice(0, limit).map(({ item }) => ({
    id: `local:${item.key}`,
    source: 'local',
    name: item.name,
    subtitle: '内置矢量',
    brandKey: item.key,
    brandColor: item.brandColor,
    category: item.category,
    watermark: item.watermark,
    emblem: item.emblem,
  }));
}

/** Auto-infers a built-in brand from an existing subscription title (e.g. "B站大会员" -> bilibili). */
export function inferBrandFromTitle(title: string): BrandCatalogItem | undefined {
  const norm = normalizeQuery(title);
  if (!norm) return undefined;
  const compact = norm.replace(/\s+/g, '');
  let bestItem: BrandCatalogItem | undefined;
  let bestScore = 0;

  for (const item of BRAND_CATALOG) {
    const sc = scoreBrandMatch(item, norm, compact);
    if (sc > bestScore) {
      bestScore = sc;
      bestItem = item;
    }
  }
  return bestScore >= 75 ? bestItem : undefined;
}

/** Detects if the user typed a website URL or domain name (e.g. 'linear.app' or 'https://cursor.com'). */
export function extractDomainFromQuery(raw: string): string | null {
  const cleaned = raw.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.toLowerCase() ?? '';
  if (!cleaned || cleaned.includes(' ')) return null;
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/i.test(cleaned)) {
    return cleaned;
  }
  return null;
}

interface ITunesAppResult {
  trackId?: number;
  trackName?: string;
  sellerName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
}

async function fetchITunesApps(term: string, country: 'cn' | 'us', limit: number, signal?: AbortSignal): Promise<IconSearchCandidate[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: ITunesAppResult[] };
  const list = Array.isArray(data.results) ? data.results : [];
  const out: IconSearchCandidate[] = [];
  for (const item of list) {
    const art = item.artworkUrl100 || item.artworkUrl60;
    const name = item.trackName?.trim();
    if (!art || !name) continue;
    // Shorten overly long Chinese App Store marketing subtitles ("哔哩哔哩 - 弹幕视频" -> "哔哩哔哩")
    const shortName = name.split(/[\-—–|:：·]/)[0]?.trim() || name;
    out.push({
      id: `appstore:${country}:${item.trackId ?? shortName}`,
      source: 'appstore',
      name: shortName.slice(0, 18),
      subtitle: 'App Store',
      previewUrl: art,
      watermark: shortName.slice(0, 14),
      emblem: shortName.slice(0, 1),
    });
  }
  return out;
}

interface IconifySearchResponse {
  icons?: string[];
}

async function fetchIconifyIcons(query: string, limit: number, signal?: AbortSignal): Promise<IconSearchCandidate[]> {
  // Iconify primarily indexes Latin service slugs; skip pure CJK queries to save bandwidth
  if (!/[a-z0-9]/i.test(query)) return [];
  const url = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefixes=simple-icons,logos&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as IconifySearchResponse;
  const icons = Array.isArray(data.icons) ? data.icons : [];
  return icons.slice(0, limit).map((id) => {
    const [prefix, slug = id] = id.split(':');
    const pretty = slug
      .replace(/-icon$/, '')
      .split('-')
      .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ''))
      .join(' ');
    const monochrome = prefix === 'simple-icons';
    return {
      id: `iconify:${id}`,
      source: 'iconify',
      name: pretty || slug,
      subtitle: monochrome ? 'Simple Icons' : '矢量 Logo',
      iconifyId: id,
      monochrome,
      previewUrl: monochrome
        ? `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(slug)}.svg?color=%23ffffff`
        : `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(slug)}.svg`,
      watermark: pretty.slice(0, 14),
      emblem: (pretty || slug).slice(0, 1).toUpperCase(),
    };
  });
}

/**
 * Tier 2 Keyless Online Icon Search (App Store CN/US + Iconify Vector + Domain Favicon).
 * Runs all relevant sources in parallel with fail-soft timeout so offline/slow links never block UI.
 */
export async function searchOnlineIcons(query: string, externalSignal?: AbortSignal): Promise<IconSearchCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  const tasks: Promise<IconSearchCandidate[]>[] = [
    fetchITunesApps(q, 'cn', 6, controller.signal).catch(() => []),
    fetchIconifyIcons(q, 5, controller.signal).catch(() => []),
  ];

  // For ASCII/global software names, also fetch US App Store so global SaaS/Mac apps appear
  if (/^[a-z0-9\s.+\-]+$/i.test(q)) {
    tasks.push(fetchITunesApps(q, 'us', 4, controller.signal).catch(() => []));
  }

  const domain = extractDomainFromQuery(q);
  const faviconCandidates: IconSearchCandidate[] = domain
    ? [
        {
          id: `favicon:${domain}`,
          source: 'favicon',
          name: domain,
          subtitle: '网站图标',
          previewUrl: `https://favicon.im/${encodeURIComponent(domain)}?larger=true`,
          watermark: domain.split('.')[0] ?? domain,
          emblem: domain.slice(0, 1).toUpperCase(),
        },
      ]
    : [];

  try {
    const normQ = normalizeQuery(q);
    const rankCandidate = (c: IconSearchCandidate): number => {
      const n = normalizeQuery(c.name);
      let s = c.source === 'favicon' ? 95 : c.source === 'appstore' ? 40 : 35;
      if (n === normQ) s += 100;
      else if (n.startsWith(normQ) || normQ.startsWith(n)) s += 65;
      else if (n.includes(normQ)) s += 30;
      return s;
    };

    const settled = await Promise.all(tasks);
    const merged: IconSearchCandidate[] = [...faviconCandidates];
    const seenUrls = new Set<string>();
    const seenNames = new Set<string>();

    for (const batch of settled) {
      for (const item of batch) {
        const keyUrl = item.previewUrl ?? item.id;
        const normName = `${item.source}:${item.name.toLowerCase()}`;
        if (seenUrls.has(keyUrl) || seenNames.has(normName)) continue;
        seenUrls.add(keyUrl);
        seenNames.add(normName);
        merged.push(item);
      }
    }
    merged.sort((a, b) => rankCandidate(b) - rankCandidate(a));
    return merged.slice(0, 12);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Pure color extractor: scans RGBA pixels from a downloaded App Store / uploaded icon,
 * ignoring near-white, near-black, and transparent backgrounds to pick the richest brand hex.
 */
export function extractDominantColorFromImageData(rgba: Uint8ClampedArray): string | undefined {
  const buckets = new Map<string, { weight: number; r: number; g: number; b: number }>();

  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < 180) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Skip washed-out whites and pure blacks
    if (lum > 0.92 || lum < 0.08) continue;
    if (sat < 0.18) continue;

    // Quantize to 32-step RGB buckets so subtle gradients cluster together
    const qr = r >> 5;
    const qg = g >> 5;
    const qb = b >> 5;
    const key = `${qr},${qg},${qb}`;
    const weight = 0.5 + sat * 2.2;
    const prev = buckets.get(key);
    if (prev) {
      prev.weight += weight;
      prev.r += r * weight;
      prev.g += g * weight;
      prev.b += b * weight;
    } else {
      buckets.set(key, { weight, r: r * weight, g: g * weight, b: b * weight });
    }
  }

  let best: { weight: number; r: number; g: number; b: number } | undefined;
  for (const b of buckets.values()) {
    if (!best || b.weight > best.weight) best = b;
  }
  if (!best) return undefined;

  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(best.r / best.weight)}${toHex(best.g / best.weight)}${toHex(best.b / best.weight)}`.toUpperCase();
}

function encodeSvgDataUrl(svgText: string): string {
  const cleaned = svgText
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .trim();
  const bytes = new TextEncoder().encode(cleaned);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

async function blobToCompressedIcon(blob: Blob): Promise<{ iconData: string; brandColor?: string }> {
  if (blob.type.includes('svg')) {
    const text = await blob.text();
    return { iconData: encodeSvgDataUrl(text) };
  }

  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_decode_failed'));
      el.src = objUrl;
    });

    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');

    // Center-crop to square
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const side = Math.min(iw, ih);
    const sx = Math.max(0, (iw - side) / 2);
    const sy = Math.max(0, (ih - side) / 2);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    let brandColor: string | undefined;
    try {
      const imgData = ctx.getImageData(0, 0, size, size);
      brandColor = extractDominantColorFromImageData(imgData.data);
    } catch {
      /* ignore tainted canvas */
    }

    let iconData = canvas.toDataURL('image/webp', 0.84);
    if (!iconData.startsWith('data:image/webp')) {
      iconData = canvas.toDataURL('image/png');
    }
    return { iconData, brandColor };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * Materializes a selected icon candidate into an offline-safe, cross-device synced payload.
 * - Local brand -> sets `brandKey` (0 bytes extra storage!)
 * - Online App Store / Iconify / Favicon -> downloads & compresses into a tiny 2-4KB inline Data URL + auto-extracted brand color!
 */
export async function materializeIconCandidate(candidate: IconSearchCandidate): Promise<MaterializedIconResult> {
  if (candidate.source === 'local' && candidate.brandKey) {
    return {
      brandKey: candidate.brandKey,
      iconData: undefined,
      brandColor: candidate.brandColor,
      category: candidate.category,
      watermark: candidate.watermark,
      emblem: candidate.emblem,
    };
  }

  if (candidate.source === 'iconify' && candidate.previewUrl) {
    const res = await fetch(candidate.previewUrl);
    if (!res.ok) throw new Error('iconify_fetch_failed');
    const svg = await res.text();
    return {
      brandKey: undefined,
      iconData: encodeSvgDataUrl(svg),
      watermark: candidate.watermark,
      emblem: candidate.emblem,
    };
  }

  if (candidate.previewUrl) {
    const res = await fetch(candidate.previewUrl);
    if (!res.ok) throw new Error('icon_fetch_failed');
    const blob = await res.blob();
    const { iconData, brandColor } = await blobToCompressedIcon(blob);
    return {
      brandKey: undefined,
      iconData,
      brandColor: brandColor ?? candidate.brandColor,
      watermark: candidate.watermark,
      emblem: candidate.emblem,
    };
  }

  return {};
}

/** Tier 3: Compresses any user-uploaded image file (PNG/JPG/WebP/SVG) into a crisp 96x96 inline Data URL. */
export async function compressUploadedIconFile(file: File): Promise<{ iconData: string; brandColor?: string }> {
  return blobToCompressedIcon(file);
}
