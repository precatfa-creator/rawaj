import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { money } from './ui';
import type { Delivery } from '../lib/celebrate';

/** How long the overlay stays up before it clears itself. */
const SHOW_MS = 3000;

/** Emerald through teal, the colours a completed delivery already wears. */
const CONFETTI_COLORS = ['#047857', '#059669', '#10b981', '#5eead4', '#fbbf24', '#ffffff'];

/**
 * Fixed positions rather than random ones: re-randomising on every render would
 * make the sparkles jump mid-animation each time React re-paints the overlay.
 */
const SPARKLES = [
  { left: 12, top: 22, delay: 0.30, duration: 1.4 },
  { left: 27, top: 68, delay: 0.48, duration: 1.3 },
  { left: 38, top: 15, delay: 0.22, duration: 1.5 },
  { left: 46, top: 82, delay: 0.55, duration: 1.2 },
  { left: 58, top: 28, delay: 0.36, duration: 1.4 },
  { left: 69, top: 74, delay: 0.44, duration: 1.3 },
  { left: 81, top: 19, delay: 0.28, duration: 1.5 },
  { left: 90, top: 58, delay: 0.52, duration: 1.3 },
  { left: 20, top: 45, delay: 0.62, duration: 1.2 },
  { left: 76, top: 42, delay: 0.58, duration: 1.4 },
] as const;

interface Particle {
  x: number; y: number; vx: number; vy: number;
  gravity: number; size: number; color: string;
  rotation: number; spin: number; life: number; decay: number;
  /** A quarter of the pieces are dots rather than ribbons, for texture. */
  round: boolean;
}

/**
 * Confetti on a canvas rather than as elements.
 *
 * Hundreds of DOM nodes animating at once is hundreds of things for the browser
 * to lay out on every frame; one canvas is a single composite. It also means the
 * burst can be cancelled cleanly when the overlay closes, instead of leaving
 * orphaned transitions running.
 *
 * Four emitters rather than one, because a single centre burst reads as a small
 * effect in the middle of a large screen: two floor cannons throw across the
 * full width, a centre burst covers the card, and a top edge rains down over
 * everything the cannons miss. The count scales with the viewport so a wide
 * monitor gets a fuller screen rather than the same handful of pieces spread
 * thinner.
 */
const burst = (canvas: HTMLCanvasElement): (() => void) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const scale = window.devicePixelRatio || 1;
  // Falling back to the window is not belt-and-braces: an effect can run before
  // the freshly mounted canvas has been laid out, and a zero height made the
  // off-screen guard below discard every particle on the first frame — the
  // burst ran, drew nothing, and left no error behind.
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);

  // Roughly one piece per 3,000 px² of viewport, floored so a phone still gets a
  // proper burst and capped so a 4K screen does not melt a laptop fan.
  const count = Math.max(220, Math.min(560, Math.round((width * height) / 3000)));

  const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

  const make = (
    x: number, y: number, angle: number, spread: number, speed: number,
  ): Particle => {
    const theta = angle + (Math.random() - 0.5) * spread;
    const velocity = speed * (0.55 + Math.random() * 0.75);
    return {
      x, y,
      vx: Math.cos(theta) * velocity,
      vy: Math.sin(theta) * velocity,
      gravity: 0.13 + Math.random() * 0.07,
      size: 6 + Math.random() * 10,
      color: pick(CONFETTI_COLORS),
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      life: 1,
      // Slower decay than a centre-only burst: pieces have the whole screen to
      // cross before they are allowed to fade out.
      decay: 0.004 + Math.random() * 0.005,
      round: Math.random() < 0.25,
    };
  };

  const UP = -Math.PI / 2;
  const particles: Particle[] = [];

  // Floor cannons, angled inward so they arc across the middle of the screen.
  const cannon = Math.round(count * 0.3);
  for (let i = 0; i < cannon; i += 1) {
    particles.push(make(0, height, UP + 0.62, 0.5, 20 + Math.random() * 9));
    particles.push(make(width, height, UP - 0.62, 0.5, 20 + Math.random() * 9));
  }

  // Centre burst, radial, around the card.
  const middle = Math.round(count * 0.25);
  for (let i = 0; i < middle; i += 1) {
    particles.push(make(width / 2, height / 2 - 30, Math.random() * Math.PI * 2, 0, 9 + Math.random() * 7));
  }

  // Top edge, drifting down over whatever the cannons did not reach.
  const rain = Math.round(count * 0.15);
  for (let i = 0; i < rain; i += 1) {
    const piece = make(Math.random() * width, -20 - Math.random() * height * 0.3, Math.PI / 2, 0.7, 2 + Math.random() * 3);
    piece.decay = 0.003 + Math.random() * 0.003;
    particles.push(piece);
  }

  let frame = 0;
  const step = () => {
    ctx.clearRect(0, 0, width, height);
    let alive = false;

    particles.forEach(p => {
      if (p.life <= 0) return;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.995;
      p.rotation += p.spin;
      p.life -= p.decay;

      // A piece already past the floor is finished; keeping it would hold the
      // animation loop open drawing nothing.
      if (p.y - p.size > height) { p.life = 0; return; }
      alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    });

    if (alive) frame = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, width, height);
  };

  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
};

/**
 * A delivery completed, shown to everyone in the store.
 *
 * `pointer-events-none` throughout: this is news, not a dialog. It never takes
 * focus, never blocks a click, and clears itself — somebody mid-sentence in a
 * form is not interrupted by a colleague finishing a delivery across town.
 */
export const Celebration: React.FC<{
  delivery: Delivery | null;
  onDone: () => void;
}> = ({ delivery, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();

  useEffect(() => {
    if (!delivery) return;
    const timer = setTimeout(onDone, SHOW_MS);
    // Reduced motion keeps the announcement and drops the flying pieces: the
    // information is the point, the confetti is the decoration.
    // One frame later, so the canvas is laid out before it is measured.
    let stop = () => {};
    const queued = requestAnimationFrame(() => {
      if (!still && canvasRef.current) stop = burst(canvasRef.current);
    });
    return () => { clearTimeout(timer); cancelAnimationFrame(queued); stop(); };
  }, [delivery?.at, still]);

  if (!delivery) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className={`absolute inset-0 bg-surface-50/70 backdrop-blur-[7px] ${still ? '' : 'animate-[fadeIn_0.45s_ease_both]'}`} />

      {/* A single light that expands past the edges of the screen, so the moment
          starts as one flash rather than as a card appearing. */}
      {!still && (
        <span
          aria-hidden
          className="absolute h-40 w-40 rounded-full animate-[glowBurst_1.25s_cubic-bezier(.16,.8,.25,1)_both]"
          style={{
            background:
              'radial-gradient(circle, rgba(16,185,129,0.30) 0%, rgba(4,120,87,0.14) 35%, transparent 70%)',
          }}
        />
      )}

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Scattered over the whole viewport rather than clustered by the card,
          which is what keeps the edges of a wide screen from feeling empty. */}
      {!still && SPARKLES.map((spark, index) => (
        <span
          key={index}
          aria-hidden
          className="absolute h-2 w-2 rounded-full bg-emerald-400 opacity-0"
          style={{
            left: `${spark.left}%`,
            top: `${spark.top}%`,
            animation: `sparkle ${spark.duration}s ease ${spark.delay}s`,
          }}
        />
      ))}

      <div
        className={`relative z-10 w-[min(30rem,calc(100vw-2.25rem))] rounded-[32px] border border-white/90 bg-white/85 px-8 pt-10 pb-9 text-center shadow-[0_30px_80px_rgba(30,65,75,0.14)] backdrop-blur-xl ${
          still ? '' : 'animate-[cardPop_0.7s_cubic-bezier(.16,1.15,.35,1)_0.15s_both]'
        }`}
      >
        <div
          className={`relative mx-auto mb-5 grid h-[86px] w-[86px] place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-primary-700 shadow-[0_18px_35px_rgba(4,120,87,0.28)] ${
            /* No `scale-0`: Tailwind v4's scale utilities set the standalone
               `scale` property, which a `transform` keyframe never overrides —
               the icon stayed invisible while its transform animated. The
               keyframe owns the whole transform, and `both` applies its 0%
               state during the delay. */
            still ? '' : 'animate-[iconPop_0.6s_cubic-bezier(.2,1.6,.4,1)_0.5s_both]'
          }`}
        >
          <span
            aria-hidden
            className={`absolute -inset-3 rounded-full border-2 border-emerald-400/25 ${
              still ? '' : 'animate-[ring_0.8s_ease-out_0.62s_both]'
            }`}
          />
          {/* Drawn from two borders rather than an icon so it can be stroked on. */}
          <span
            aria-hidden
            className={`h-[22px] w-[38px] rounded-[2px] border-b-[5px] border-l-[5px] border-white ${
              still ? '-rotate-45' : 'animate-[checkIn_0.35s_cubic-bezier(.3,1.5,.5,1)_0.83s_both]'
            }`}
          />
        </div>

        <h2 className={`text-3xl font-black leading-tight text-surface-900 ${still ? '' : 'animate-[textUp_0.5s_ease_0.72s_both]'}`}>
          تم تسليم الطلب!
        </h2>

        <p className={`mt-2.5 text-sm leading-relaxed text-surface-600 ${still ? '' : 'animate-[textUp_0.5s_ease_0.85s_both]'}`}>
          <span className="font-mono font-bold text-surface-900" dir="ltr" translate="no">{delivery.orderNumber}</span>
          {' · '}
          {delivery.customerName}
          <span className="mt-1 block text-lg font-black tabular-nums text-emerald-700">{money(delivery.total)}</span>
          {delivery.by && <span className="mt-1 block text-xs text-surface-500">أنجزه {delivery.by}</span>}
        </p>
      </div>
    </div>
  );
};
