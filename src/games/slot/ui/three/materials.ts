"use client";

import * as THREE from "three";

/**
 * The cabinet's own reflection environment and its glass.
 *
 * Brass only reads as metal when a dark room holds a few bright, hard-edged
 * things to reflect (3d-metal-material). The room's drei <Environment> is the
 * stage's to change, so the cabinet prefilters its own small studio of cards
 * with PMREM and binds it to its metal and lacquer explicitly. That also pins
 * envMapIntensity per material: three ignores it when the map comes only from
 * scene.environment.
 */

type Card = { size: [number, number]; at: [number, number, number]; rgb: [number, number, number] };

/** linear radiance, metres around a cabinet at the origin facing +Z (the player is at +X+Z) */
const CARDS: Card[] = [
  // the key's softbox, above and in front: the long highlight along top edges and the bullnose
  { size: [3.6, 1.0], at: [0.6, 4.6, 2.6], rgb: [3.1, 2.55, 2.15] },
  // a warm low card front-left: front faces seen from the player's seat mirror toward it
  { size: [2.2, 1.2], at: [-2.8, 0.9, 3.6], rgb: [1.05, 0.78, 0.6] },
  // a broad, dim warm fill out front, so faces turned to the player read as brass, never as brown
  { size: [6, 2.6], at: [0.4, 1.3, 5.2], rgb: [0.42, 0.32, 0.26] },
  // the topper neon as a thin strip behind and above (kept low: it shows in the bezel's bottom lip, right under the reels)
  { size: [2.8, 0.14], at: [0, 3.0, -2.8], rgb: [1.5, 0.2, 0.8] },
  // Monad-purple side wash, left (#6E54FF)
  { size: [1.6, 3.6], at: [-4.6, 1.8, 0.4], rgb: [0.31, 0.19, 1.0] },
  // a narrow Monad-cyan kicker (#85E6FF), right, so cylinder edges catch a cool line
  { size: [0.5, 2.8], at: [3.6, 1.7, 2.2], rgb: [0.42, 0.78, 1.0] },
  // a lavender overhead card (#DDD7FE) behind the key, so top faces read lit from the house lights
  { size: [3.0, 1.6], at: [-1.2, 4.8, -0.6], rgb: [0.72, 0.68, 0.98] },
  // the floor's faint bounce
  { size: [10, 10], at: [0, -3.2, 0], rgb: [0.05, 0.025, 0.035] },
];

export function buildCabinetEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(0.012, 0.007, 0.012, THREE.LinearSRGBColorSpace);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mats: THREE.Material[] = [];
  for (const c of CARDS) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(...c.rgb, THREE.LinearSRGBColorSpace),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    mats.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(c.size[0], c.size[1], 1);
    mesh.position.set(...c.at);
    mesh.lookAt(0, 1.2, 0);
    scene.add(mesh);
  }
  const pm = new THREE.PMREMGenerator(gl);
  const rt = pm.fromScene(scene, 0.012, 0.1, 30);
  pm.dispose();
  geo.dispose();
  mats.forEach((m) => m.dispose());
  return rt.texture;
}

/**
 * Cap the direct (punctual-light) specular, clearcoat included, under the
 * stage's bloom threshold (1.1, linear). The key spot is very bright; on a
 * polished bevel or lacquer facing it, its glint would sit far above the
 * threshold and haze the reel window it frames. The base and clear-coat
 * lobes share one cap (they add up in the output). Environment reflections
 * (the cards) are untouched, so brass and lacquer keep their structure.
 */
export function capDirectSpecular<M extends THREE.MeshStandardMaterial>(m: M, cap = 0.8): M {
  const c = cap.toFixed(2);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>
      reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(${c}));
      #ifdef USE_CLEARCOAT
        clearcoatSpecularDirect = min(clearcoatSpecularDirect, max(vec3(${c}) - reflectedLight.directSpecular, vec3(0.0)));
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `cap-spec-sum-${cap}`;
  return m;
}

const glassVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * The shadow side of the glass: the bezel lip shades the top row a little,
 * the sides a touch less, and the pane itself absorbs a few percent. Normal
 * blending, dark only, so it can never add light over the symbols.
 */
export function glassShadeMaterial(aspect: number) {
  return new THREE.ShaderMaterial({
    vertexShader: glassVert,
    fragmentShader: /* glsl */ `
      uniform float uAspect;
      varying vec2 vUv;
      void main() {
        float top = 1.0 - smoothstep(0.0, 0.16, 1.0 - vUv.y);
        float bottom = 1.0 - smoothstep(0.0, 0.07, vUv.y);
        float side = 1.0 - smoothstep(0.0, 0.05, min(vUv.x, 1.0 - vUv.x) * uAspect);
        float a = 0.05 + 0.42 * top * top + 0.22 * bottom + 0.28 * side;
        gl_FragColor = vec4(0.02, 0.008, 0.016, clamp(a, 0.0, 0.7));
      }`,
    uniforms: { uAspect: { value: aspect } },
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

/**
 * The bright side of the glass: one soft diagonal reflection band and a thin
 * catch along the top edge, added at a few percent. Unlit on purpose, so the
 * key spot never puts a white hotspot (and a bloom halo) over the reels.
 */
export function glassSheenMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: glassVert,
    fragmentShader: /* glsl */ `
      uniform float uFlash;
      uniform vec3 uFlashColor;
      varying vec2 vUv;
      void main() {
        float d = vUv.x * 0.78 + vUv.y * 0.62;
        float band = exp(-pow((d - 1.02) / 0.1, 2.0)) * 0.045 + exp(-pow((d - 1.2) / 0.025, 2.0)) * 0.03;
        float lip = smoothstep(0.965, 1.0, vUv.y) * 0.035;
        vec3 col = vec3(1.0, 0.9, 0.84) * (band + lip) + uFlashColor * uFlash;
        gl_FragColor = vec4(col, 1.0);
      }`,
    uniforms: { uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1.0, 0.55, 0.85) } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}
