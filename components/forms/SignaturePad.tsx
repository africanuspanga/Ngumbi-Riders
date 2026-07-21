'use client';

import { useRef, useState, useEffect } from 'react';

/*
 * Lightweight drawn-signature capture (spec §8.8, §10.5). Emits a transparent
 * PNG data URL via onChange. Uses pointer events so it works with touch on
 * low-cost Android. No external dependency to keep the client bundle small.
 */
export function SignaturePad({
  value,
  onChange,
  clearLabel = 'Futa',
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  clearLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size the backing store to the element's CSS box. Re-run when the box
    // changes (late layout with width 0 at first paint, or device rotation) —
    // otherwise the pointer→canvas coordinate mapping drifts and strokes land
    // offset from the finger on low-cost Android.
    function sizeCanvas() {
      const el = canvasRef.current;
      if (!el) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width * ratio);
      const h = Math.round(rect.height * ratio);
      if (w === 0 || h === 0 || (el.width === w && el.height === h)) return;
      el.width = w;
      el.height = h;
      const ctx = el.getContext('2d');
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#122117';
      }
    }

    sizeCanvas();
    const observer = new ResizeObserver(() => sizeCanvas());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange('');
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-[--radius-card] border border-border bg-white"
      />
      <button
        type="button"
        onClick={clear}
        disabled={!hasInk}
        className="self-end text-sm font-medium text-muted-foreground disabled:opacity-50"
      >
        {clearLabel}
      </button>
    </div>
  );
}
