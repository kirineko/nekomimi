import { expect, type Locator } from '@playwright/test';
/** Exercise the UI's bounded attachment reader, including later byte pages. */
export async function readArtifact(region: Locator, index = 1) {
    const toggle = region.getByRole('button', { name: new RegExp(`^(读取|收起)原始附件 ${index}$`) });
    const reader = toggle.locator('..');
    await toggle.click();
    let text = '';
    for (let page = 0; page < 40; page++) {
        await expect(reader.locator('pre')).toBeVisible();
        text += await reader.locator('pre').textContent();
        const next = reader.getByRole('button', { name: '继续读取附件', exact: true });
        if (await next.isDisabled())
            return text;
        const position = reader.getByText(/^偏移 /), previous = await position.textContent();
        await next.click();
        await expect(position).not.toHaveText(previous!);
    }
    throw Error('Fixture attachment exceeded 40 browser pages');
}
