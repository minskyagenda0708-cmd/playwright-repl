import type { Page } from 'playwright-crx';

// Shape returned by page.accessibility.snapshot()
interface AXNode {
  role: string;
  name: string;
  value?: string | number;
  description?: string;
  children?: AXNode[];
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  selected?: boolean;
  readonly?: boolean;
  required?: boolean;
  multiline?: boolean;
  level?: number;
}

export interface RefEntry {
  role: string;
  name: string;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio',
  'combobox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'slider', 'spinbutton', 'switch', 'tab',
  'searchbox', 'treeitem',
]);

let refMap = new Map<string, RefEntry>();
let refCounter = 0;

export async function snapshot(page: Page): Promise<string> {
  const tree = await page.accessibility.snapshot();
  if (!tree) return '(empty page)';

  refMap.clear();
  refCounter = 0;
  return formatNode(tree, 0);
}

function formatNode(node: AXNode, indent: number): string {
  const lines: string[] = [];
  const pad = '  '.repeat(indent);

  const isInteractive = INTERACTIVE_ROLES.has(node.role);
  let ref = '';
  if (isInteractive) {
    ref = `e${++refCounter}`;
    refMap.set(ref, { role: node.role, name: node.name });
  }

  // Build node description
  let desc = `${node.role}`;
  if (node.name) desc += ` "${node.name}"`;
  if (ref) desc += ` [ref=${ref}]`;

  // State annotations
  const states: string[] = [];
  if (node.checked === true) states.push('checked');
  if (node.checked === 'mixed') states.push('mixed');
  if (node.disabled) states.push('disabled');
  if (node.expanded === true) states.push('expanded');
  if (node.expanded === false) states.push('collapsed');
  if (node.selected) states.push('selected');
  if (node.pressed === true) states.push('pressed');
  if (node.readonly) states.push('readonly');
  if (node.required) states.push('required');
  if (states.length) desc += ` [${states.join(', ')}]`;

  if (node.value !== undefined) desc += `: "${node.value}"`;

  lines.push(`${pad}- ${desc}`);

  if (node.children) {
    for (const child of node.children) {
      lines.push(formatNode(child, indent + 1));
    }
  }

  return lines.join('\n');
}

export function resolveRef(ref: string): RefEntry {
  const entry = refMap.get(ref);
  if (!entry) throw new Error(`Unknown ref: ${ref}. Run "snapshot" first.`);
  return entry;
}

export function getRefMap(): Map<string, RefEntry> {
  return refMap;
}
