import { expect, it, vi } from 'vitest';
import { startWeb } from '../src/server/app.js';
import { temporary } from './helpers.js';

it('internal HTTP errors do not expose raw credentials through legacy debug output', async () => {
  const secret = 'synthetic-http-error-credential';
  const app = await startWeb({workspace: await temporary(), home: await temporary(), apiKey: secret, naming: false});
  const session = await app.sessions.create('错误隐私检查');
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEKOMIMI_DEBUG_HTTP', '1');
  const entry = vi.spyOn(app.sessions, 'entry').mockRejectedValueOnce(new Error(`Provider rejected ${secret}`));
  try {
    const response = await fetch(`${app.origin}/api/v1/sessions/${session.id}/snapshot`, {
      headers: {authorization: `Bearer ${app.token}`, origin: app.origin},
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('操作失败，请检查本地配置和数据完整性');
    expect(body).not.toContain(secret);
    expect(stderr.mock.calls.flat().map(String).join('\n')).not.toContain(secret);
  } finally {
    entry.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
    await app.close();
  }
});
