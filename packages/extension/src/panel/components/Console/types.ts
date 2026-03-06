export type SerializedValue =
  | { __type: 'null' }
  | { __type: 'undefined' }
  | { __type: 'string';   v: string }
  | { __type: 'number';   v: number }
  | { __type: 'boolean';  v: boolean }
  | { __type: 'function'; name: string }
  | { __type: 'object';   cls: string; props: Record<string, SerializedValue>; objectId?: string }
  | { __type: 'array';    cls: string; len: number; props: Record<string, SerializedValue>; objectId?: string }
  | { __type: 'ref';      cls: string; objectId?: string }
  | { __type: 'circular' }
  | { __type: 'error' };

export interface ConsoleEntry {
  id: string;
  input: string;
  status: 'pending' | 'done' | 'error';
  value?: SerializedValue;
  text?: string;
  errorText?: string;
}

export interface ConsoleExecutors {
  playwright: (code: string) => Promise<{ value?: SerializedValue; text?: string }>;
  js: (expression: string) => Promise<{ value?: SerializedValue; text?: string }>;
}

export interface ConsoleHandle {
  clear: () => void;
}

export interface ConsoleProps {
  executors: ConsoleExecutors;
  className?: string;
}
