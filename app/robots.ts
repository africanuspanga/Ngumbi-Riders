import type { MetadataRoute } from 'next';

// Two-role private tool: only the landing page and the public application form
// are meant to be discoverable. Keep crawlers out of login and the app areas.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', '/apply'],
        disallow: ['/'],
      },
    ],
  };
}
