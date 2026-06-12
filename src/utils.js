/**
 * Detect song language category from iTunes metadata.
 * Priority: genre string match → Unicode script detection.
 */
export function detectCategory(title, artist, genre) {
  const g = (genre || '').toLowerCase();
  const text = (title || '') + ' ' + (artist || '');

  if (/\bj-?pop\b|\bj-?rock\b|\banime\b|\benka\b|\bvocaloid\b|\bjpop\b/i.test(g)) return 'japanese';
  if (/\bk-?pop\b|\bkpop\b|\bkorean\b/i.test(g)) return 'korean';
  if (/\bmandopop\b|\bcantopop\b|\bchinese\b|\btaiwanese\b|\bhokkien\b/i.test(g)) return 'chinese';

  // Hiragana / Katakana → Japanese
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'japanese';
  // Hangul → Korean
  if (/[가-힯ᄀ-ᇿ]/.test(text)) return 'korean';
  // CJK unified ideographs → Chinese (fallback after Japanese check)
  if (/[一-鿿]/.test(text)) return 'chinese';

  return 'western';
}
