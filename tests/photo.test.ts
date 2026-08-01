// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { shrink } from '$lib/photo';

describe('guest photo normalization', () => {
  test('applies the image orientation recorded by the camera', async () => {
    const bitmap = { width: 400, height: 300, close: vi.fn() };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', create);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/webp;base64,avatar',
    );
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    await expect(shrink(file)).resolves.toBe('data:image/webp;base64,avatar');
    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
