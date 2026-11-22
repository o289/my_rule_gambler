import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { COIN_TRAVEL_MS } from '../model/bank-model';
import type { BankDirection } from '../model/bank-model';
import type { Flight } from '../application/bank-player';
import { GoldCoin } from './coin';

interface Point { x: number; y: number }

interface Path {
  from: Point;
  startCurve: Point;
  endCurve: Point;
  to: Point;
  size: number;
}

export function pointAlong(path: Path, fraction: number) {
  const t = Math.max(0, Math.min(1, fraction));
  const n = 1 - t;
  return {
    x: n ** 3 * path.from.x + 3 * n ** 2 * t * path.startCurve.x + 3 * n * t ** 2 * path.endCurve.x + t ** 3 * path.to.x,
    y: n ** 3 * path.from.y + 3 * n ** 2 * t * path.startCurve.y + 3 * n * t ** 2 * path.endCurve.y + t ** 3 * path.to.y,
  };
}

interface FlyingNodes {
  shell: HTMLDivElement;
  rotor: HTMLSpanElement;
}

function localCenter(rect: DOMRect, boundary: DOMRect) {
  return { x: rect.left + rect.width / 2 - boundary.left, y: rect.top + rect.height / 2 - boundary.top };
}

function easeFlight(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

export function CoinFlights({ flights, stage, direction }: { flights: ReadonlyMap<string, Flight>; stage: RefObject<HTMLDivElement | null>; direction: BankDirection }) {
  const trails = useRef<HTMLCanvasElement>(null);
  const shells = useRef(new Map<string, HTMLDivElement>());
  const rotors = useRef(new Map<string, HTMLSpanElement>());

  useLayoutEffect(() => {
    const scene = stage.current;
    const canvas = trails.current;
    if (!scene || !canvas || !flights.size) return;
    const context = canvas.getContext('2d');
    const deposit = direction === 'deposit';
    const points = new Map<string, Path>();
    const actors = new Map<string, FlyingNodes>();
    let width = 0;
    let height = 0;
    let frame = 0;

    function measure() {
      if (!scene || !canvas) return;
      const boundary = scene.getBoundingClientRect();
      const available = scene.querySelector('#vault-mouth');
      if (!available) return;
      width = boundary.width;
      height = boundary.height;
      const ratio = Math.min(window.devicePixelRatio || 1, width < 540 ? 1.15 : 1.55);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      const target = localCenter(available.getBoundingClientRect(), boundary);
      for (const [id, flight] of flights) {
        const selector = deposit
          ? `[data-flight-target="${CSS.escape(id)}"]`
          : `[data-coin-id="${CSS.escape(id)}"] .coin-in-tray`;
        const anchor = scene.querySelector<HTMLElement>(selector);
        const shell = shells.current.get(id);
        const rotor = rotors.current.get(id);
        if (!anchor || !shell || !rotor) continue;
        const source = localCenter(anchor.getBoundingClientRect(), boundary);
        const lane = (flight.index % 2 === 0 ? -1 : 1) * Math.min(118, width * .17);
        const rise = Math.min(height * .20, 170);
        const trayCurve = { x: source.x + lane, y: source.y - rise * .90 };
        const vaultCurve = { x: target.x + lane * .78, y: target.y + rise * .08 };
        const path = deposit
          ? { from: target, startCurve: vaultCurve, endCurve: trayCurve, to: source, size: anchor.offsetWidth }
          : { from: source, startCurve: trayCurve, endCurve: vaultCurve, to: target, size: anchor.offsetWidth };
        points.set(id, path);
        actors.set(id, { shell, rotor });
        shell.style.setProperty('--coin-size', `${path.size}px`);
      }
    }

    function paintTrail(path: Path, progress: number, radius: number) {
      if (!context) return;
      const segments = width < 540 ? 13 : 19;
      for (let part = 0; part < segments; part += 1) {
        const head = progress - part * .012;
        const tail = head - .012;
        if (head <= 0) break;
        const first = pointAlong(path, easeFlight(head));
        const second = pointAlong(path, easeFlight(Math.max(0, tail)));
        const fade = (1 - part / segments) * Math.sin(Math.PI * Math.min(.96, progress + .04));
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.lineCap = 'round';
        context.lineWidth = Math.max(.8, radius * fade * .19);
        context.strokeStyle = `rgba(244, 165, 62, ${fade * .59})`;
        context.stroke();
        if (part % 5 === 0) {
          context.beginPath();
          context.arc(second.x, second.y, Math.max(.7, radius * .042), 0, Math.PI * 2);
          context.fillStyle = `rgba(255, 222, 150, ${fade * .87})`;
          context.fill();
        }
      }
    }

    function render(now: number) {
      if (context) {
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = 'lighter';
      }
      let moving = false;
      for (const [id, flight] of flights) {
        const path = points.get(id);
        const node = actors.get(id);
        if (!path || !node) continue;
        const progress = Math.max(0, Math.min(1, (now - flight.startedAt) / COIN_TRAVEL_MS));
        const eased = easeFlight(progress);
        const position = pointAlong(path, eased);
        const swell = Math.sin(progress * Math.PI) * .17;
        const scale = deposit ? .16 + .84 * eased ** .77 + swell : 1 + swell - .85 * eased ** 1.4;
        const turn = flight.index % 2 === 0 ? 1 : -1;
        const half = path.size / 2;
        node.shell.style.transform = `translate3d(${position.x - half}px,${position.y - half}px,0) scale(${scale})`;
        node.shell.style.opacity = String(Math.min(1, deposit ? .68 + progress : 1.28 - progress * .44));
        const small = flight.coin.value < 50;
        node.rotor.style.transform = deposit
          ? `rotateX(${(small ? 27 : 22) + 61 * (1 - progress)}deg) rotateY(${turn * 1080 * eased - (small ? 11 : 6)}deg) rotateZ(${(small ? 5 : 3) + turn * 118 * (1 - progress)}deg)`
          : `rotateX(${22 + 65 * progress}deg) rotateY(${turn * 1000 * eased}deg) rotateZ(${turn * (3 + 118 * progress)}deg)`;
        const light = Math.abs(Math.cos(eased * Math.PI * 5.6)) * 136 - 18;
        node.rotor.style.setProperty('--coin-specular', `${light}%`);
        paintTrail(path, progress, Math.max(4, path.size * scale * .50));
        if (progress < 1) moving = true;
      }
      if (moving) frame = requestAnimationFrame(render);
    }

    function resize() {
      measure();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(scene);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, [flights, stage, direction]);

  if (!flights.size) return null;
  return (
    <div className="flight-layer" aria-hidden="true">
      <canvas ref={trails} />
      {[...flights.values()].map(({ coin }) => (
        <div className="flying-coin" data-flying-coin={coin.id} data-coin-value={coin.value} key={coin.id} ref={element => {
          if (element) shells.current.set(coin.id, element);
          else shells.current.delete(coin.id);
        }}>
          <GoldCoin coin={coin} rotor={element => {
            if (element) rotors.current.set(coin.id, element);
            else rotors.current.delete(coin.id);
          }} />
        </div>
      ))}
    </div>
  );
}
