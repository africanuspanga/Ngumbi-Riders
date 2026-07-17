import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

// Security response headers applied to every route. Snippe/Resend/Supabase
// secrets never reach the browser, so the CSP intentionally forbids inline
// script and restricts connect-src to same-origin + Supabase.
// Content-Security-Policy. script/style allow inline for Next's hydration
// bootstrap (nonce-based CSP is a tracked hardening follow-up). connect-src is
// limited to same-origin + Supabase (https + realtime wss) + Snippe.
// 'unsafe-eval' is only needed by next dev (React Refresh); in production it
// would neuter what little XSS mitigation script-src provides on an app that
// renders rider-supplied free text.
const scriptSrc =
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.snippe.sh",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never bundle server-only secrets or the admin client into client code.
  // @react-pdf/renderer is a heavy Node renderer kept out of the bundle.
  serverExternalPackages: ['@supabase/supabase-js', '@react-pdf/renderer', 'web-push'],
  experimental: {
    serverActions: {
      // Owner uploads go through server actions (scanned signed contracts,
      // XLSX imports) — the 1 MB default rejects real-world files.
      bodySizeLimit: '15mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
