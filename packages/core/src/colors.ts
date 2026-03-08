/**
 * Terminal color helpers.
 * No dependency — just ANSI escape codes.
 */

export const c: Record<string, string> = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  gray:    '\x1b[90m',
};

export function prettyJson(text: string): string {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    const colored = pretty.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        if (/^".*":$/.test(match)) return c.yellow + match + c.reset;  // key
        if (/^"/.test(match))      return c.green  + match + c.reset;  // string
        if (/null/.test(match))    return c.gray   + match + c.reset;  // null
        return c.cyan + match + c.reset;                                // number/bool
      }
    );
    const lines = colored.split('\n');
    if (lines.length > 100) return lines.slice(0, 100).join('\n') + `\n${c.gray}…(truncated)${c.reset}`;
    return colored;
  } catch {
    return text;
  }
}
