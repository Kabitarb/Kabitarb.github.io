// Live TV: official channels' own free 24/7 live streams, played in YouTube's
// embedded player (nothing is proxied or re-streamed), plus the user's own
// legal links (a channel's live link or an HLS .m3u8 stream they have access to).
export const TV_CHANNELS = [
  { id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'Al Jazeera English', cat: 'News', lang: 'English' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News', cat: 'News', lang: 'English' },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News', cat: 'News', lang: 'English' },
  { id: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', name: 'FRANCE 24 English', cat: 'News', lang: 'English' },
  { id: 'UCSrZ3UV4jOidv8ppoVuvW9Q', name: 'euronews', cat: 'News', lang: 'English' },
  { id: 'UCVgO39Bk5sMo66-6o6Spn6Q', name: 'ABC News (Australia)', cat: 'News', lang: 'English' },
  { id: 'UC83jt4dlz1Gjl58fzQrrKZg', name: 'CNA', cat: 'News', lang: 'English' },
  { id: 'UC7fWeaHhqgM4Ry-RMpM2YYw', name: 'TRT World', cat: 'News', lang: 'English' },
  { id: 'UCSPEjw8F2nQDtmUKPFNF7_A', name: 'NHK WORLD-JAPAN', cat: 'News', lang: 'English' },
  { id: 'UCYPvAwZP8pZhSMW8qs7cVCw', name: 'India Today', cat: 'News', lang: 'English' },
  { id: 'UC_gUM8rL-Lrg6O3adPW9K1g', name: 'WION', cat: 'News', lang: 'English' },
  { id: 'UCef1-8eOpJgud7szVPlZQAQ', name: 'CNN-News18', cat: 'News', lang: 'English' },
  { id: 'UCt4t-jeY85JegMlZ-E5UWtA', name: 'Aaj Tak', cat: 'News', lang: 'Hindi' },
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'Bloomberg Television', cat: 'Business', lang: 'English' },
  { id: 'UCLA_DiR1FfKNvjuUpBHmylQ', name: 'NASA', cat: 'Science & space', lang: 'English' },
  { id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl', cat: 'Music', lang: '—' },
];
export const TV_CATS = ['All', 'News', 'Business', 'Science & space', 'Music'];
export const tvUrl = (channelId) => `https://www.youtube.com/channel/${channelId}/live`;
export const tvEmbed = (channelId) => `https://www.youtube-nocookie.com/embed/live_stream?channel=${channelId}&autoplay=1&playsinline=1&rel=0`;
export const tvById = (channelId) => TV_CHANNELS.find((c) => c.id === channelId) || null;
export const tvHue = (name) => [...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
