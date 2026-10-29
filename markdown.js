// Deliberately small authored subset: headings, paragraphs, and absolute HTTPS links.
// Output is data for text nodes/DOM construction, never HTML.
// Validate before URL normalization can hide whitespace, credentials or slashes.
function safeHTTPS(href) {
  if (!/^https:\/\/[^/]/i.test(href)
    || /[(\s\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(href)
    || /^https:\/\/[^/?#]*@/i.test(href)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(href)) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
const UNSAFE_LABEL = /[\[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;

function inlineParts(text) {
  const parts = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('[', cursor);
    if (start < 0) break;
    const close = text.indexOf(']', start + 1);
    if (close < 0) break;
    if (text[close + 1] !== '(') { cursor = close + 1; continue; }
    const end = text.indexOf(')', close + 2);
    if (end < 0) break;
    const label = text.slice(start + 1, close);
    const href = text.slice(close + 2, end);
    // Consume unsupported syntax as text, including nested links and images.
    if (text[start - 1] !== '!' && text[start - 1] !== '\\'
      && label.trim() && !UNSAFE_LABEL.test(label) && safeHTTPS(href)) {
      if (start > plainStart) parts.push({text: text.slice(plainStart, start)});
      parts.push({text: label, href});
      plainStart = end + 1;
    }
    cursor = end + 1;
  }
  if (plainStart < text.length) parts.push({text: text.slice(plainStart)});
  return parts;
}

export function markdownBlocks(source) {
  if (typeof source !== 'string') return [];
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({tag: 'p', parts: inlineParts(paragraph.join('\n'))});
    paragraph = [];
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) { flushParagraph(); continue; }
    const heading = /^(#{1,3})[ \t]+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({tag: `h${heading[1].length}`, parts: inlineParts(heading[2])});
    } else paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
