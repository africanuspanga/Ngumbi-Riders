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
      // Square icons at the declared sizes (the old single icon was a
      // 1178×821 non-square file declared 512×512, which Android distorts or
      // rejects). A maskable variant keeps the adaptive-icon mask from
      // clipping the logo on Android launchers.
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
