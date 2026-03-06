export type ConsoleMode = 'pw' | 'playwright' | 'js';

export interface ConsoleEntry {
  id: string;
  input: string;
  mode: ConsoleMode;
  status: 'pending' | 'done' | 'error';
  text?: string;       // pw / playwright result text
  value?: unknown;     // js result (for ObjectTree)
  image?: string;      // screenshot base64
  errorText?: string;
}

export interface ConsoleExecutors {
  pw: (cmd: string) => Promise<{ text: string; isError: boolean; image?: string }>;
  playwright: (code: string) => Promise<string>;
  js: (expr: string) => Promise<{ value?: unknown; text?: string; isError: boolean }>;
}

export interface ConsoleHandle {
  clear: () => void;
}

export interface ConsoleProps {
  executors: ConsoleExecutors;
  className?: string;
}