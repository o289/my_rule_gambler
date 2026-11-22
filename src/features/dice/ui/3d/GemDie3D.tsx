import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GEMS } from '../../../board/model/gems';
import { DIE_BEVEL, DIE_SIZE, FACES } from '../../model/geometry';
import type { GemId } from '../../model/geometry';
import { TUMBLE_DURATION } from '../../model/die-motion';
import { preloadDice } from '../face-canvases';

export function GemDie3D({ gem, animate, forceSettled, onSettled }: {
  gem: GemId; animate: boolean; forceSettled?: boolean; onSettled?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState('');
  const settle = useRef({ forceSettled, onSettled });
  useLayoutEffect(() => { settle.current = { forceSettled, onSettled }; }, [forceSettled, onSettled]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let disposed = false;
    let raf = 0;
    let resizeObserver: ResizeObserver | undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setProblem('このブラウザでは3Dダイスを開始できませんでした。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    node.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 40);
    camera.position.set(2.9, 3.25, 4.2);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffeaca, 0x20150e, 1.9));
    const key = new THREE.DirectionalLight(0xffd5a0, 3.1);
    key.position.set(-3.5, 6, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb7d7ff, 1.2);
    fill.position.set(4, 2, -3);
    scene.add(fill);
    const rim = new THREE.PointLight(0xf8be68, 26, 8);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    const geometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_BEVEL);
    const materials = FACES.map(() => new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .33, metalness: .2, emissive: 0xffd89c, emissiveIntensity: .045,
    }));
    const cube = new THREE.Mesh(geometry, materials);
    cube.castShadow = true;
    scene.add(cube);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 64),
      new THREE.MeshBasicMaterial({ color: 0xa36a35, transparent: true, opacity: .13 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.7;
    scene.add(floor);

    const textureSet: THREE.Texture[] = [];
    const size = () => {
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      render();
    };
    resizeObserver = new ResizeObserver(size);
    resizeObserver.observe(node);

    const targetAxis = FACES.find(face => face.gem === gem)?.axis;
    const up = new THREE.Vector3(0, 1, 0);
    const axis = targetAxis ?? [0, 1, 0];
    const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(axis[0], axis[1], axis[2]), up);
    const initial = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.07, .44, .82));
    const current = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const spinAxis = new THREE.Vector3(.2, 1, -.1).normalize();
    const duration = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? TUMBLE_DURATION : 0;
    let startedAt: number | null = null;

    function render() {
      renderer.render(scene, camera);
    }

    function frame(now: number) {
      if (disposed) return;
      if (!duration || settle.current.forceSettled) {
        cube.quaternion.copy(target);
        render();
        settle.current.onSettled?.();
        return;
      }
      const start = startedAt ?? now;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      current.slerpQuaternions(initial, target, eased);
      spin.setFromAxisAngle(spinAxis, Math.PI * 2 * 4 * (1 - eased));
      if (progress < 1) cube.quaternion.copy(spin).multiply(current);
      else cube.quaternion.copy(target);
      render();
      if (progress < 1) raf = requestAnimationFrame(frame);
      else settle.current.onSettled?.();
    }

    void preloadDice().then(canvases => {
      if (disposed) {
        return;
      }
      canvases.forEach((canvas, index) => {
        const material = materials[index];
        if (!material) return;
        const map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        material.map = map;
        material.emissiveMap = map;
        material.needsUpdate = true;
        textureSet.push(map);
      });
      startedAt = performance.now();
      if (duration) raf = requestAnimationFrame(frame);
      else frame(performance.now());
    }).catch(() => {
      if (!disposed) setProblem('3Dダイスの画像を読み込めませんでした。');
    });

    size();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      textureSet.forEach(texture => texture.dispose());
      geometry.dispose();
      materials.forEach(material => material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [animate, gem]);

  return <div className="dice-display-3d" ref={host} role="img" aria-label={`${GEMS[gem].name}の宝石ダイス`}>
    {problem && <span role="status">{problem}</span>}
  </div>;
}
