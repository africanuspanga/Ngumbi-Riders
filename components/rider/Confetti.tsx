'use client';

import { useState } from 'react';

/*
 * Dependency-free celebratory confetti (payment received). Pieces fall once via
 * a CSS keyframe defined in globals.css. Purely decorative — aria-hidden, no
 * pointer events, hidden under prefers-reduced-motion. Kept tiny on purpose for
 * low-bandwidth Android. This only ever mounts client-side (after a payment
 * completes), so generating pieces in the state initializer is hydration-safe.
 */
const COLORS = ['#2F8F46', '#F79009', '#22c55e', '#1f6f37', '#facc15'];

type Piece = {
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
};

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 1.6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    size: 6 + Math.random() * 8,
  }));
}

export function Confetti({ count = 60 }: { count?: number }) {
  const [pieces] = useState<Piece[]>(() => makePieces(count));

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.6}px`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
