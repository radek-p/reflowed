// Print the keymap as the README's Markdown table (src/keys.ts is the source; regenerate after a change).
//   node workbench/scripts/keys-table.ts
import { KEYMAP, keysOf, label, NAMES, type Keys, type Platform } from '../src/keys.ts';

const rows: string[] = [];
const seen = new Set<string>();
for (const e of KEYMAP) {
  if (e.action === 'focusGroup') {
    if (seen.has('focusGroup')) continue;
    seen.add('focusGroup');
    rows.push(`| ${NAMES.focusGroup} | ⌘1 … ⌘8 | Ctrl+1 … Ctrl+8 | workbench.action.focusFirstEditorGroup … Eighth: Ctrl+1 … Ctrl+8 / ⌘1 … ⌘8 | same |`);
    continue;
  }
  const key = e.action;
  const grouped = ['focusSide', 'moveToward', 'toggleSide', 'focusPart'].includes(e.action);
  const lab = (k: Keys, p: Platform) => (k ? (typeof k === 'string' ? [k] : k).map((x) => label(x, p)).join(' or ') : '');    // several bindings: each
  const mac = lab(keysOf(e, 'mac'), 'mac') || '—';
  const other = lab(keysOf(e, 'win'), 'win') || '—';
  const name = grouped ? `${NAMES[key]}: ${e.arg}` : NAMES[key];
  rows.push(`| ${name} | ${mac} | ${other} | ${e.vscode} | ${e.note ?? 'same'} |`);
}
console.log('| action | macOS | Windows, Linux | VS Code (command: its keys) | ours |\n|---|---|---|---|---|\n' + rows.join('\n'));
