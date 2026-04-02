/**
 * Downloads VS Code stable before E2E tests run.
 * Cached in .vscode-test/ — only downloads once.
 */
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download.js';

export default async () => {
  await downloadAndUnzipVSCode('stable');
};
