// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');
const css = readFileSync(path.join(here, 'globals.css'), 'utf8');
const uiContext = readFileSync(path.resolve(srcDir, '../../context/ui-context.md'), 'utf8');

/** Token → value pairs from the ui-context.md colour table (e.g. "--bg-base\t#363640"). */
function tokensFromUiContext() {
  const pairs = [...uiContext.matchAll(/(--[a-z-]+)\s+(#[0-9a-fA-F]{6})\b/g)];
  return new Map(pairs.map(([, name, value]) => [name, value.toLowerCase()]));
}

function rootBlock() {
  const match = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  return match ? match[1] : '';
}

function listSourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(jsx?|css)$/.test(entry) && !entry.includes('.test.') ? [full] : [];
  });
}

describe('theme tokens', () => {
  const expected = tokensFromUiContext();

  it('reads the full palette from ui-context.md', () => {
    expect(expected.size).toBe(19);
  });

  it('defines every ui-context.md colour token with the documented value', () => {
    const root = rootBlock();
    for (const [name, value] of expected) {
      const declared = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`));
      expect(declared?.[1].toLowerCase(), name).toBe(value);
    }
  });

  it('is dark-only', () => {
    expect(rootBlock()).toMatch(/color-scheme:\s*dark;/);
    expect(css).not.toMatch(/\.dark\b|prefers-color-scheme/);
  });

  it('maps shadcn/ui variables onto the palette instead of raw colours', () => {
    const root = rootBlock();
    for (const name of [
      'background',
      'foreground',
      'card',
      'popover',
      'primary',
      'border',
      'ring',
    ]) {
      expect(root, name).toMatch(new RegExp(`--${name}:\\s*var\\(--[a-z-]+\\);`));
    }
  });

  it('keeps hex colours out of every file except the token block', () => {
    const offenders = listSourceFiles(srcDir).filter((file) => {
      const text = readFileSync(file, 'utf8');
      const withoutTokens = file.endsWith('globals.css') ? text.replace(rootBlock(), '') : text;
      return /#[0-9a-fA-F]{3,8}\b/.test(withoutTokens);
    });
    expect(offenders).toEqual([]);
  });
});
