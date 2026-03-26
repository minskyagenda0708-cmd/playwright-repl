export interface RunOptions {
  testDir: string;
  timeout: number;
  headed: boolean;
  grep?: string;
  retries: number;
  workers: number;
  baseURL?: string;
  forceNode?: boolean;
}

export interface TestResult {
  name: string;
  file: string;
  passed: boolean;
  skipped: boolean;
  error?: string;
  duration: number;
  line?: number;   // 1-based line number from reporter output
}

export interface DiscoveredTest {
  title: string;     // leaf test name (e.g. "test name")
  fullName: string;  // full path with describes (e.g. "describe > test name")
  line: number;      // 1-based line number
  column: number;
}

export interface PlaywrightConfig {
  testDir?: string;
  timeout?: number;
  retries?: number;
  workers?: number;
  use?: {
    baseURL?: string;
    storageState?: string;
    [key: string]: unknown;
  };
  globalSetup?: string;
  globalTeardown?: string;
  reporter?: string | string[][] | unknown;
  projects?: unknown[];
}
