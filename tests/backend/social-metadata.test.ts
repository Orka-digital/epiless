import { describe, expect, it } from 'vitest';
import {
  socialImageUrl,
  timestampLabel,
} from '../../apps/web/src/lib/social-metadata';

describe('generic static social image', () => {
  it('uses the configured HTTPS build origin even with local prerender bindings', () => {
    expect(
      socialImageUrl('https://audit.example.org', 'http://localhost:4387'),
    ).toBe('https://audit.example.org/social/epi-less-preview-v1.png');
  });
  it('uses the configured local Worker port instead of the default Astro port', () => {
    expect(
      socialImageUrl('http://localhost:4321', 'http://localhost:4387'),
    ).toBe('http://localhost:4387/social/epi-less-preview-v1.png');
  });
  it('supports a configured HTTPS runtime with a local build default', () => {
    expect(
      socialImageUrl('http://localhost:4321', 'https://audit.example.org'),
    ).toBe('https://audit.example.org/social/epi-less-preview-v1.png');
  });
  it.each([
    'http://public.example.org',
    'https://example.org/path?token=secret',
    'https://user:password@example.org',
    'javascript:alert(1)',
  ])('rejects noncanonical or insecure configuration %s', (origin) => {
    expect(() => socialImageUrl(origin)).toThrow();
  });
});

it('prints the supplied timestamp in Brussels with time and timezone', () => {
  expect(timestampLabel('2026-10-20T10:00:15Z')).toContain('12:00:15');
  expect(timestampLabel('2026-12-20T10:00:15Z')).toContain('11:00:15');
});
