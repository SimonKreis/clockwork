/**
 * Choosing the browser, without depending on the machine the suite runs on.
 *
 * The detector reads the Windows registry and looks for files, and both differ on every machine.
 * What is tested here is the part that has to be right everywhere: reading reg.exe output in any
 * display language, and telling a Chromium build Playwright can drive from a browser it cannot.
 */

import { expect, test } from '@playwright/test';
import { chromiumName, parseCommandExecutable, parseProgId } from '../src/browser';

test('reads the default browser ProgId out of reg.exe output', () => {
  const out = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
    '    ProgId    REG_SZ    MSEdgeHTM',
    '',
  ].join('\n');
  expect(parseProgId(out)).toBe('MSEdgeHTM');
});

test('reads the executable out of a shell open command, on a localised Windows', () => {
  // A French Windows prints "(par défaut)" as the value name, and reg.exe output read with the
  // wrong code page mangles its accent. Only the quoted path matters, so the parse must not care.
  const out =
    '    (par d\u00c3\u00a9faut)    REG_SZ    ' +
    '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1';
  expect(parseCommandExecutable(out)).toBe(
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  );
});

test('knows which installed browsers Playwright can drive, and which it cannot', () => {
  expect(chromiumName('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBe(
    'Microsoft Edge',
  );
  expect(chromiumName('C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe')).toBe(
    'Brave',
  );
  expect(chromiumName('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe(
    'Google Chrome',
  );
  expect(chromiumName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe(
    'Google Chrome',
  );
  // Playwright cannot drive an installed Firefox: it needs its own patched build. A default
  // browser that is Firefox has to be skipped, not attempted and left to fail obscurely.
  expect(chromiumName('C:\\Program Files\\Mozilla Firefox\\firefox.exe')).toBeNull();
});
