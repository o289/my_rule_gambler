import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { preloadDice } from '../face-canvases';
import { DIE_BEVEL, DIE_SIZE, FACES, TRAY, releaseAt } from '../../model/geometry';
import type { DiePose, RollView } from '../../../../shared/contracts/dice';
import type { FrameStream } from '../connection';
import { ROLL_RESULT_DISPLAY_MS } from '../../model/roll-presentation';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

function grainTexture(velvet: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const brush = canvas.getContext('2d');
  if (brush) {
    const pixels = brush.createImageData(128, 128);
    let seed = 1234;
    for (let index = 0; index < pixels.data.length; index += 4) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const noise = (seed >>> 26) - 30;
      const thread = (Math.floor(index / 4) % 3 === 0 ? 4 : 0);
      pixels.data[index] = velvet ? 17 + noise * .21 : 24 + noise * .38;
      pixels.data[index + 1] = velvet ? 54 + noise * .56 + thread : 18 + noise * .3;
      pixels.data[index + 2] = velvet ? 40 + noise * .42 : 15 + noise * .27;
      pixels.data[index + 3] = 255;
    }
    brush.putImageData(pixels, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

interface TrayOptions {
  host: HTMLDivElement;
  stream: FrameStream;
  roll: () => RollView;
  fps: (value: number | null) => void;
  cupCue: () => void;
  error: (message: string) => void;
  resultComplete: () => void;
}

function createTray({ host, stream, roll, fps, cupCue, error, resultComplete }: TrayOptions) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth <= 640 ? 1.1 : 1.25));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 3.5, -3.5, .1, 50);
  camera.position.set(0, 18, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const lighting = generator.fromScene(environment, .06);
  scene.environment = lighting.texture;
  environment.dispose();
  generator.dispose();

  const hemi = new THREE.HemisphereLight(0xffeaca, 0x253d32, 1.46);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffdbac, 2.55);
  key.position.set(-4, 9, -4);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(innerWidth <= 640 ? 384 : 640);
  key.shadow.camera.left = key.shadow.camera.bottom = -7;
  key.shadow.camera.right = key.shadow.camera.top = 7;
  key.shadow.normalBias = .025;
  key.shadow.bias = -.00035;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb4d6ff, .66);
  fill.position.set(5, 5, 4);
  scene.add(fill);

  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];

  function geometry<T extends THREE.BufferGeometry>(object: T) { geometries.push(object); return object; }
  function material<T extends THREE.Material>(object: T) { materials.push(object); return object; }
  function texture<T extends THREE.Texture>(object: T) { textures.push(object); return object; }

  const felt = texture(grainTexture(true));
  felt.repeat.set(6, 4);
  const leatherGrain = texture(grainTexture(false));
  leatherGrain.repeat.set(3, 2);
  const velvet = material(new THREE.MeshStandardMaterial({ map: felt, roughness: .96, metalness: .03 }));
  const leather = material(new THREE.MeshStandardMaterial({ color: 0x9b897c, map: leatherGrain, roughness: .89, metalness: .08 }));
  const gold = material(new THREE.MeshStandardMaterial({ color: 0xba853f, roughness: .39, metalness: .73 }));
  const trim = material(new THREE.MeshStandardMaterial({ color: 0xc99756, roughness: .46, metalness: .58 }));

  function box(size: [number, number, number], p: [number, number, number], surface: THREE.Material, bevel = 0) {
    const cube = new THREE.Mesh(geometry(bevel ? new RoundedBoxGeometry(...size, 2, bevel) : new THREE.BoxGeometry(...size)), surface);
    cube.position.set(...p);
    cube.castShadow = bevel > 0;
    cube.receiveShadow = true;
    scene.add(cube);
    return cube;
  }

  const { width, depth, floor, wall, wallHeight } = TRAY;
  box([width, floor, depth], [0, -floor / 2, 0], velvet);
  for (const sign of [-1, 1]) {
    box([width + wall * 2, wallHeight, wall], [0, wallHeight / 2, sign * (depth + wall) / 2], leather, .06);
    box([wall, wallHeight, depth], [sign * (width + wall) / 2, wallHeight / 2, 0], leather, .06);
    box([width + wall * 1.52, .046, .046], [0, wallHeight + .014, sign * (depth + wall) / 2], trim, .01);
    box([.048, .046, depth + wall * .94], [sign * (width + wall) / 2, wallHeight + .014, 0], gold, .01);
    box([width - .38, .008, .016], [0, .004, sign * (depth / 2 - .20)], trim);
    box([.016, .008, depth - .42], [sign * (width / 2 - .20), .004, 0], trim);
  }

  const cup = new THREE.Group();
  const cupDark = material(new THREE.MeshStandardMaterial({ color: 0x382b22, roughness: .91, side: THREE.BackSide }));
  const cupGeometry = geometry(new THREE.CylinderGeometry(.73, .57, 1.46, 40, 1, true));
  cup.add(new THREE.Mesh(cupGeometry, leather), new THREE.Mesh(cupGeometry, cupDark));
  const base = new THREE.Mesh(geometry(new THREE.CylinderGeometry(.57, .55, .09, 36)), leather);
  base.position.y = -.72;
  cup.add(base);
  for (const [height, radius, tube] of [[.726, .73, .046], [-.65, .58, .025], [.61, .71, .018]]) {
    const ring = new THREE.Mesh(geometry(new THREE.TorusGeometry(radius ?? .7, tube ?? .03, 10, 45)), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height ?? 0;
    cup.add(ring);
  }
  cup.traverse(item => { if (item instanceof THREE.Mesh) item.castShadow = true; });
  scene.add(cup);

  const model = geometry(new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_BEVEL));
  const cubes = Array.from({ length: 5 }, () => {
    const sides = FACES.map(() => material(new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .36, metalness: .23, emissive: 0xffedce, emissiveIntensity: 0,
    })));
    const body = new THREE.Mesh(model, sides);
    body.castShadow = body.receiveShadow = true;
    body.visible = false;
    scene.add(body);
    return { body, sides };
  });

  let disposed = false;
  void preloadDice().then(canvases => {
    if (disposed) return;
    const maps = canvases.map(canvas => {
      const map = texture(new THREE.CanvasTexture(canvas));
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 6);
      return map;
    });
    for (const { sides } of cubes) sides.forEach((side, index) => {
      side.map = maps[index] ?? null;
      side.emissiveMap = side.map;
      side.needsUpdate = true;
    });
    invalidate();
  }).catch(() => { if (!disposed) error('宝石の画像を読み込めませんでした。'); });

  function resize() {
    const rect = host.getBoundingClientRect();
    const ratio = rect.width / Math.max(1, rect.height);
    const halfWidth = Math.max(5.8, ratio * 3.37);
    const halfHeight = halfWidth / Math.max(.1, ratio);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  const observer = new ResizeObserver(resize);

  const point = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  let raf: number | null = null;
  let lastShadow = -Infinity;
  let fpsAt = performance.now();
  let frames = 0;
  let resultAt = -Infinity;
  let resultRoll = '';
  let completedRoll = '';
  let cupRoll = '';
  let previousTime = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function cupAt(time: number, reroll: boolean) {
    const fromRight = 7.7;
    const edge = 4.0;
    if (reroll && time < 970) {
      cup.visible = true;
      const x = time < 310 ? THREE.MathUtils.lerp(fromRight, edge, smooth(time / 310))
        : THREE.MathUtils.lerp(edge, fromRight, smooth((time - 670) / 270));
      cup.position.set(x, 1.43, .02);
      cup.rotation.z = -.12 + .77 * smooth((time - 238) / 252);
      return;
    }
    const prep = (reroll ? 970 : 0);
    const pour = releaseAt(reroll ? 'reroll' : 'initial');
    cup.visible = time > prep + 80 && time < pour + 495;
    if (!cup.visible) return;
    const inMotion = smooth((time - prep - 95) / (pour - prep - 235));
    const out = smooth((time - pour - 212) / 275);
    cup.position.set(THREE.MathUtils.lerp(fromRight, edge, inMotion) + (fromRight - edge) * out, 1.44 + .08 * out, .04);
    cup.rotation.z = .14 + .94 * smooth((time - pour + 230) / 255) - .82 * out;
  }

  function pose(body: THREE.Mesh, previous: DiePose, next: DiePose, blend: number) {
    body.position.set(...previous.p).lerp(point.set(...next.p), blend);
    body.quaternion.set(...previous.q).slerp(orientation.set(...next.q), blend);
    body.scale.setScalar(1);
  }

  function invalidate() {
    if (!disposed && raf === null) raf = requestAnimationFrame(render);
  }

  function render(now: number) {
    raf = null;
    const view = roll();
    const interpolated = stream.sample(view.id, now);
    const time = interpolated?.time ?? view.latest.simMs;
    const a = interpolated?.a ?? view.latest;
    const b = interpolated?.b ?? view.latest;
    const blend = interpolated?.blend ?? 0;
    if (view.results.length && resultRoll !== view.id) {
      resultRoll = view.id;
      resultAt = now;
      renderer.shadowMap.needsUpdate = true;
    }
    const reroll = view.kind === 'reroll';
    cupAt(time, reroll);
    if (cupRoll !== view.id) {
      cupRoll = view.id;
      previousTime = time > 450 ? time : 0;
    }
    for (const cue of reroll ? [152, 1115] : [176]) {
      if (previousTime < cue && time >= cue && time - cue < 300) cupCue();
    }
    previousTime = time;

    const collecting = view.kind === 'reroll' && time < 728;
    const poses = collecting ? view.previous : a.dice;
    cubes.forEach(({ body, sides }, index) => {
      const current = poses[index];
      body.visible = Boolean(current);
      if (!current) return;
      const next = b.dice.find(die => die.id === current.id) ?? current;
      pose(body, current, collecting ? current : next, collecting ? 0 : blend);
      if (collecting) {
        const travel = smooth((time - 250 - index * 42) / 365);
        body.position.lerp(point.set(3.91, 1.62, .10), travel);
        body.position.y += Math.sin(travel * Math.PI) * .37;
        body.scale.setScalar(1 - .75 * travel);
        body.visible = travel < .99;
      }
      const gem = view.results.find(die => die.id === current.id)?.gem;
      const glow = gem && !reduced.matches ? Math.max(0, 1 - (now - resultAt) / 1020) : 0;
      sides.forEach((side, face) => {
        side.emissiveIntensity = FACES[face]?.gem === gem ? glow * .42 : 0;
      });
    });

    if (time < view.latest.simMs || !view.results.length) {
      if (now - lastShadow >= 47) {
        renderer.shadowMap.needsUpdate = true;
        lastShadow = now;
      }
    }
    renderer.render(scene, camera);
    frames += 1;
    if (now - fpsAt >= 970) {
      fps(frames * 1000 / (now - fpsAt));
      frames = 0;
      fpsAt = now;
    }
    if (!view.results.length || (!reduced.matches && now - resultAt < ROLL_RESULT_DISPLAY_MS)) invalidate();
    else if (completedRoll !== view.id) {
      completedRoll = view.id;
      resultComplete();
    }
  }
  observer.observe(host);
  resize();

  return {
    invalidate,
    dispose() {
      disposed = true;
      observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
      key.shadow.dispose();
      lighting.dispose();
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      for (const item of textures) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export default function TrayScene({ stream, roll, onFps, onCup, onResultComplete }: {
  stream: FrameStream;
  roll: RollView;
  onFps: (fps: number | null) => void;
  onCup: () => void;
  onResultComplete: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const current = useRef(roll);
  const refresh = useRef<(() => void) | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => { current.current = roll; refresh.current?.(); }, [roll]);
  useEffect(() => {
    if (!node.current) return;
    try {
      const renderer = createTray({
        host: node.current, stream, roll: () => current.current,
        fps: onFps, cupCue: onCup, error: setProblem, resultComplete: onResultComplete,
      });
      refresh.current = renderer.invalidate;
      return () => {
        refresh.current = null;
        renderer.dispose();
      };
    } catch {
      setProblem('このブラウザでは3D表示を開始できませんでした。確定結果は下に表示します。');
    }
  }, [stream, onFps, onCup, onResultComplete]);
  const hasResults = roll.results.length > 0;
  useEffect(() => {
    if (!problem || !hasResults) return;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ROLL_RESULT_DISPLAY_MS;
    const timer = window.setTimeout(onResultComplete, duration);
    return () => window.clearTimeout(timer);
  }, [problem, hasResults, onResultComplete]);
  return <div className="tray-visual" ref={node} aria-label="真上から見たサーバー同期ダイストレイ">
    {problem && <p className="tray-problem" role="status">{problem}</p>}
  </div>;
}
