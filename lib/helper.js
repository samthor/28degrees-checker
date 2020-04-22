
import {promises as fs} from 'fs';


export async function loadJSON(p, def) {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return def;
}


export async function maybeGoto(page, url) {
  if (urlIs(page, url)) {
    await page.goto(url, {waitUntil: 'networkidle2'});
  }
}


export function urlIs(page, url) {
  const u = new URL(page.url());
  u.search = '';
  u.hash = '';
  return u.toString() === url;
}


export function randomRange(low, high) {
  return Math.random() * (high - low) + low;
}


/**
 * Given an element, convert its contents to a floating-point number.
 *
 * Used by Puppeteer eval code.
 *
 * @param {!Element} element
 * @return {number}
 */
export function valueFromElement(element) {
  let text = element.textContent.trim();
  text = text.replace(/[^\d\.\-]/g, '');
  return parseFloat(text);
}
