import { describe, expect, it, vi } from 'vitest';

import {
  createViewportWorkspace,
  restoreViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';
import { fixture } from './viewport-workspace.fixture';
describe('workspace creation and late cleanup interleavings', () => {
  it('leaves a workspace alone when the user focuses it while restoration is settling', async () => {
    const f = fixture();
    const workspace = await createViewportWorkspace(f.options);
    vi.mocked(f.driver.move).mockClear();
    f.options.wait.mockImplementation(async () => {
      f.windows.get(2)!.focused = true;
    });
    await expect(
      restoreViewportWorkspace({ workspace, ...f.options }),
    ).rejects.toThrow('VIEWPORT_WORKSPACE_BECAME_USER_WINDOW');
    expect(f.driver.move).not.toHaveBeenCalled();
    expect(f.target.windowId).toBe(2);
  });
});
