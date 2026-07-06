import type { MetadataRoute } from 'next';

// PWA manifest (spec §26.1). The full service worker, install UX and push are
// Phase 8; this establishes the installable identity and green theme now.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ng'umbi Riders",
    short_name: 'Ngumbi',
    description: 'Malipo na mikataba kwa waendesha pikipiki.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F9F7',
    theme_color: '#2F8F46',
    lang: 'sw',
    icons: [
      {
        src: '/icons/logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
