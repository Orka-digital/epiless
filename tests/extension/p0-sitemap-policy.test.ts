import { describe, expect, it, vi } from 'vitest';

import {
  discoverSitemap,
  parseSitemap,
  robotsAllows,
} from '../../apps/chrome-extension/src/sitemap';

describe('bounded sitemap discovery', () => {
  it('accepts normal sitemap namespaces and rejects entities and oversized candidate lists', () => {
    expect(
      parseSitemap(
        '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/a</loc></url></urlset>',
      ),
    ).toEqual({ kind: 'urls', urls: ['https://example.test/a'] });
    expect(() =>
      parseSitemap(
        '<!DOCTYPE urlset [<!ENTITY evil SYSTEM "file:///secret">]><urlset></urlset>',
      ),
    ).toThrow('SITEMAP_UNSUPPORTED_XML');
    expect(() =>
      parseSitemap(
        '<urlset>' +
          '<loc>https://example.test/a</loc>'.repeat(501) +
          '</urlset>',
      ),
    ).toThrow('SITEMAP_CANDIDATE_LIMIT');
  });

  it('honors robots exclusions and longest matching allowances', () => {
    const robots =
      'User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /products/*/edit$';
    expect(robotsAllows('https://example.test/private/hidden', robots)).toBe(
      false,
    );
    expect(
      robotsAllows('https://example.test/private/public/info', robots),
    ).toBe(true);
    expect(robotsAllows('https://example.test/products/4/edit', robots)).toBe(
      false,
    );
    expect(
      robotsAllows('https://example.test/products/4/edit/help', robots),
    ).toBe(true);
    expect(
      robotsAllows(
        'https://example.test/private',
        robots + '\nUser-agent: FlashGuard\nAllow: /',
      ),
    ).toBe(true);
  });

  it('cannot bypass robots paths through unreserved percent encoding or Unicode spelling', () => {
    expect(
      robotsAllows(
        'https://example.test/%70rivate/info',
        'User-agent: *\nDisallow: /private',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/private/info',
        'User-agent: *\nDisallow: /%70rivate',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/caf%C3%A9/menu',
        'User-agent: *\nDisallow: /café',
      ),
    ).toBe(false);
    expect(
      robotsAllows(
        'https://example.test/other',
        'User-agent: *\nDisallow: /\nAllow: /%2A',
      ),
    ).toBe(false);
  });

  it('fetches only safe exact-origin documents without cookies or redirects, excludes transactions and private routes', async () => {
    const documents: Record<string, string> = {
      'https://example.test/robots.txt':
        'User-agent: *\nDisallow: /private\nSitemap: https://example.test/sitemap.xml',
      'https://example.test/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://evil.test/feed.xml</loc></sitemap><sitemap><loc>https://example.test/pages.xml</loc></sitemap></sitemapindex>',
      'https://example.test/pages.xml':
        '<urlset>' +
        [
          '/about',
          '/private',
          '/logout',
          '/info?token=secret',
          'https://other.test/',
        ]
          .map(
            (route) =>
              `<url><loc>${route.startsWith('http') ? route : `https://example.test${route}`}</loc></url>`,
          )
          .join('') +
        '</urlset>',
    };
    const fetcher = vi.fn(
      async (url: string | URL | Request, options?: RequestInit) => {
        expect(options).toMatchObject({
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        expect(String(url)).toMatch(/^https:\/\/example.test\//);
        return new Response(documents[String(url)] ?? '', {
          status: documents[String(url)] ? 200 : 404,
        });
      },
    );
    const guard = vi.fn(async () => undefined);
    expect(
      (await discoverSitemap('https://example.test', guard, fetcher)).urls,
    ).toEqual(['https://example.test/about']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(guard).toHaveBeenCalled();
  });

  it('stops document traversal and does not bypass unavailable robots checks', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('robots.txt'))
        return new Response('', { status: 404 });
      return new Response(
        '<sitemapindex>' +
          [1, 2, 3, 4]
            .map(
              (n) =>
                `<sitemap><loc>https://example.test/sitemap${n}.xml</loc></sitemap>`,
            )
            .join('') +
          '</sitemapindex>',
      );
    });
    const result = await discoverSitemap(
      'https://example.test',
      async () => undefined,
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(4); // robots + at most three sitemap documents
    expect(result.limitations).toContain('SITEMAP_DOCUMENT_LIMIT');
    const unavailable = vi.fn(async () => new Response('', { status: 403 }));
    expect(
      (
        await discoverSitemap(
          'https://example.test',
          async () => undefined,
          unavailable,
        )
      ).urls,
    ).toEqual([]);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
