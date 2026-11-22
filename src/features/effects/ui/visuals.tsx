import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import ringImage from './media/gold-ring.webp';
import starImage from './media/spark-sprite.webp';

export interface Point { x: number; y: number }

export function centerWithin(element: Element, boundary: Element): Point {
  const child = element.getBoundingClientRect();
  const shell = boundary.getBoundingClientRect();
  return { x: child.left + child.width / 2 - shell.left, y: child.top + child.height / 2 - shell.top };
}

export function GoldText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`gold-text ${className}`}>{children}</span>;
}

export function ScreenFlash({ grand }: { grand: boolean }) {
  return createPortal(<div className={`screen-flash ${grand ? 'screen-flash--grand' : ''}`} aria-hidden="true" />, document.body);
}

export function useScreenShake(stage: RefObject<HTMLDivElement | null>, enabled: boolean, grand = false) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const target = stage.current?.querySelector('.stage-surface');
    if (!target) return;
    const n = grand ? 8 : 4;
    const shake = target.animate([
      { transform: 'translate3d(0,0,0)' },
      { offset: .16, transform: `translate3d(${n}px,${-n * .5}px,0)` },
      { offset: .39, transform: `translate3d(${-n * .72}px,${n * .38}px,0)` },
      { offset: .64, transform: `translate3d(${n * .38}px,${-n * .25}px,0)` },
      { transform: 'translate3d(0,0,0)' },
    ], { duration: grand ? 450 : 320, easing: 'ease-out' });
    return () => shake.cancel();
  }, [stage, enabled, grand]);
}

export function Shockwave({ className = '', point }: { className?: string; point?: Point }) {
  const position: CSSProperties | undefined = point && { left: point.x, top: point.y };
  return <img className={`fx-shockwave ${className}`} style={position} src={ringImage} alt="" aria-hidden="true" />;
}

export function CountUp({ points, immediate }: { points: number; immediate: boolean }) {
  const value = useRef<HTMLOutputElement>(null);
  useLayoutEffect(() => {
    const output = value.current;
    if (!output || immediate) return;
    let frame = 0;
    const started = performance.now();
    const format = new Intl.NumberFormat('ja-JP');
    function count(now: number) {
      if (!output) return;
      const progress = Math.min(1, (now - started) / 1120);
      output.value = `+${format.format(Math.round(points * (1 - (1 - progress) ** 3)))}`;
      if (progress < 1) frame = requestAnimationFrame(count);
    }
    output.value = '+0';
    frame = requestAnimationFrame(count);
    return () => cancelAnimationFrame(frame);
  }, [points, immediate]);
  return <output className="fx-counter" ref={value} aria-hidden="true">{immediate ? `+${points.toLocaleString('ja-JP')}` : '+0'}</output>;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; size: number;
  turn: number; spin: number; color: string; spark: boolean;
}

const GOLD = ['#fff1aa', '#eac061', '#d9923e', '#fff6d3', '#be732a', '#ffd673'];
const rand = (low: number, high: number) => low + Math.random() * (high - low);

const sprite = new Image();
sprite.src = starImage;

type BurstKind = 'big' | 'grand' | 'comeback';

export function GoldParticles({ kind, stage }: { kind: BurstKind; stage: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const surface = canvas.current;
    const ctx = surface?.getContext('2d');
    if (!surface || !ctx) return;
    const grand = kind === 'grand';
    const compact = window.innerWidth <= 740;
    const cap = compact ? (grand ? 85 : 44) : (grand ? 160 : 90);
    const scale = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.6);
    const particles: Particle[] = [];
    let width = window.innerWidth;
    let height = window.innerHeight;
    let frame = 0;

    function sizeCanvas() {
      if (!surface || !ctx) return;
      width = window.innerWidth;
      height = window.innerHeight;
      surface.width = Math.round(width * scale);
      surface.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    const stageRect = stage.current?.getBoundingClientRect();
    const centerX = stageRect ? Math.max(0, Math.min(width, stageRect.left + stageRect.width / 2)) : width * .5;
    const centerY = stageRect ? Math.max(0, Math.min(height, stageRect.top + stageRect.height * .48)) : height * .45;
    const burstCount = kind === 'comeback' ? Math.floor(cap * .39) : Math.floor(cap * .85);
    for (let index = 0; index < burstCount; index += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(115, Math.min(720, width * (grand ? 1.35 : .91)));
      particles.push({
        x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * .68,
        age: 0, life: rand(.58, grand ? 1.9 : 1.39), size: rand(2, grand ? 8 : 6),
        turn: angle, spin: rand(-7.4, 8), color: GOLD[index % GOLD.length] ?? '#ffc36c', spark: index % 4 === 0,
      });
    }

    const started = performance.now();
    let previous = started;
    let nextFoil = started + 330;
    function render(now: number) {
      if (!ctx) return;
      const elapsed = now - started;
      const dt = Math.min(.045, (now - previous) / 1000);
      previous = now;
      if (grand && now >= nextFoil && elapsed < 2690) {
        nextFoil = now + (compact ? 119 : 85);
        for (let index = 0; index < (compact ? 2 : 4) && particles.length < cap; index += 1) {
          particles.push({
            x: rand(width * .015, width * .985), y: rand(-65, -10), vx: rand(-48, 48), vy: rand(70, 143),
            age: 0, life: rand(1.05, 2.2), size: rand(3.5, 8.6), turn: rand(-Math.PI, Math.PI),
            spin: rand(-6, 7), color: GOLD[index % GOLD.length] ?? '#efac4c', spark: false,
          });
        }
      }
      ctx.clearRect(0, 0, width, height);
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        if (!particle) continue;
        particle.age += dt;
        if (particle.age >= particle.life || particle.y > height + 17) { particles.splice(index, 1); continue; }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 1 - dt * 1.17;
        particle.vy += dt * (particle.spark ? 59 : 106);
        particle.turn += particle.spin * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, (1 - particle.age / particle.life) * 2.8));
        const { x, y, size } = particle;
        if (particle.spark && sprite.complete && sprite.naturalWidth) {
          ctx.drawImage(sprite, x - size * 2.8, y - size * 2.8, size * 5.6, size * 5.6);
        } else {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(particle.turn);
          ctx.fillStyle = particle.color;
          ctx.fillRect(-size * .5, -size * .24, size, size * (.19 + Math.abs(Math.cos(particle.turn)) * .38));
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      if (particles.length || (grand && elapsed < 2690)) frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', sizeCanvas);
      cancelAnimationFrame(frame);
    };
  }, [kind, stage]);

  return createPortal(<canvas className="fx-particles" ref={canvas} aria-hidden="true" />, document.body);
}
