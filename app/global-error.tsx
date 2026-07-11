'use client';

/*
 * Last-resort boundary: replaces the root layout when it crashes, so it must
 * render its own <html>/<body> and cannot rely on app styles being present.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sw">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Kuna hitilafu imetokea</h1>
          <p style={{ maxWidth: '24rem', fontSize: '0.875rem', color: '#555', margin: 0 }}>
            Samahani, kitu hakikwenda sawa. Angalia mtandao wako kisha jaribu tena.
            <br />
            (Something went wrong. Check your connection and try again.)
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#166534',
              color: '#fff',
              border: 0,
              borderRadius: '0.75rem',
              padding: '0.75rem 1.5rem',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Jaribu tena
          </button>
        </div>
      </body>
    </html>
  );
}
