/**
 * Skill discovery and parsing.
 *
 * Scans a skills directory for subdirectories containing SKILL.md,
 * parses YAML frontmatter into typed SkillInfo objects.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  preconditions?: string;
  parameters?: { name: string; description: string }[];
  output?: string;
  dir: string;            // absolute path to skill directory
  pwFile?: string;        // path to .pw file (if exists)
  jsFile?: string;        // path to .js file (if exists)
  source: 'builtin' | 'user';  // where the skill was discovered
}

// ─── Frontmatter parsing ────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles the simple subset used by skill definitions:
 * scalar fields, and `parameters:` as a list of `- key: description` entries.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let listItems: { name: string; description: string }[] = [];

  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    // List item: "  - key: value"
    const listMatch = line.match(/^\s+-\s+(\w+):\s*(.*)$/);
    if (listMatch && currentKey) {
      listItems.push({ name: listMatch[1], description: listMatch[2].trim() });
      continue;
    }

    // Top-level key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      // Flush previous list
      if (currentKey && listItems.length > 0) {
        result[currentKey] = listItems;
        listItems = [];
      }
      const [, key, value] = kvMatch;
      currentKey = key;
      if (value) {
        result[key] = value;
        currentKey = null;
      }
      continue;
    }
  }

  // Flush trailing list
  if (currentKey && listItems.length > 0) {
    result[currentKey] = listItems;
  }

  return result;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Scan a single directory for skills. Returns unsorted results.
 */
function scanSkillsDir(skillsDir: string, source: 'builtin' | 'user'): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) return [];

  const skills: SkillInfo[] = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(skillsDir, entry.name);
    const skillMd = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const info = parseSkillMd(skillMd, dir, source);
    if (info) skills.push(info);
  }

  return skills;
}

/**
 * Discover all skills from both the builtin skills directory and the user
 * skills directory (~/.stagecraft/skills/). User skills with the same name
 * as a builtin skill take precedence (override).
 *
 * @param builtinDir - absolute path to the package's bundled skills directory
 * @param userDir    - user skills directory (default: ~/.stagecraft/skills)
 */
export function discoverSkills(builtinDir: string, userDir?: string): SkillInfo[] {
  const resolvedUserDir = userDir ?? path.join(
    process.env['HOME'] || process.env['USERPROFILE'] || '~',
    '.stagecraft',
    'skills',
  );

  const builtin = scanSkillsDir(builtinDir, 'builtin');
  const user = scanSkillsDir(resolvedUserDir, 'user');

  // User skills override builtin skills of the same name
  const byName = new Map<string, SkillInfo>();
  for (const skill of builtin) byName.set(skill.name, skill);
  for (const skill of user) byName.set(skill.name, skill);   // overrides

  const skills = Array.from(byName.values());
  skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return skills;
}

/**
 * Parse a single SKILL.md file into a SkillInfo object.
 */
function parseSkillMd(filepath: string, dir: string, source: 'builtin' | 'user'): SkillInfo | null {
  const content = fs.readFileSync(filepath, 'utf-8');
  const data = parseFrontmatter(content);
  if (!data) return null;

  const name = data.name as string;
  const description = data.description as string;
  const category = data.category as string;
  if (!name || !description || !category) return null;

  // Find .pw and .js files in the skill directory
  const files = fs.readdirSync(dir);
  const pwFile = files.find(f => f.endsWith('.pw'));
  const jsFile = files.find(f => f.endsWith('.js'));

  return {
    name,
    description,
    category,
    preconditions: data.preconditions as string | undefined,
    parameters: data.parameters as { name: string; description: string }[] | undefined,
    output: data.output as string | undefined,
    dir,
    pwFile: pwFile ? path.join(dir, pwFile) : undefined,
    jsFile: jsFile ? path.join(dir, jsFile) : undefined,
    source,
  };
}

/**
 * Find a skill by name from the discovered list.
 */
export function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
  return skills.find(s => s.name === name);
}
