/*
 * Rider profile picture with a clean placeholder (build spec #3).
 *
 * Photos live in the PRIVATE rider-documents bucket, so `photoUrl` is always a
 * short-lived signed URL minted server-side — never a public object URL. When
 * there is no photo (or the signed URL has expired) we fall back to the rider's
 * initials rather than a broken image.
 *
 * Plain <img> rather than next/image: the signed URL's host carries a one-hour
 * token and a rotating query string, which defeats the image optimizer's cache
 * and would re-optimize the same photo on every render.
 */

function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function RiderAvatar({
  photoUrl,
  name,
  size = 40,
  className = '',
}: {
  photoUrl: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const dimension = { width: size, height: size };

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`${name}'s profile picture`}
        style={dimension}
        className={`shrink-0 rounded-full border border-border object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  return (
    <span
      style={dimension}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border border-border bg-surface font-semibold text-muted-foreground ${className}`}
    >
      <span style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}>{initialsOf(name)}</span>
    </span>
  );
}
