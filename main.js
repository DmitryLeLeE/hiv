import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WORLD } from './map-data.js';
import { buildZine, scrawl, xeroxDust, rng as seeded, penPath, subdivide } from './zine.js';

/* =========================================================
   helpers
   ========================================================= */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pulse = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const col = (hex) => new THREE.Color(hex);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rand();

function fibonacciSphere(n) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(V(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  return out;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(max-width: 760px)').matches;

/* =========================================================
   palette
   ========================================================= */
const C = {
  red: col('#b09a9a'),       // erythrocytes: pale enough to read as grey glyphs in b&w
  crimson: col('#2a0006'),
  mag: col('#ff1a33'),       // virus: fresh blood
  violet: col('#77736c'),    // nucleus / infected: ash
  cyan: col('#ece6d6'),      // T-cell: bone
  deepCyan: col('#161513'),
  lime: col('#fff4ea'),      // Env spikes: pale bone
  gold: col('#f2ecdc'),      // capsid / DNA: bone
  white: col('#ffffff'),
};

/* =========================================================
   renderer / scene
   ========================================================= */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('ready');
  const p = document.createElement('p');
  p.className = 'nogl';
  p.textContent = 'WebGL недоступен — 3D-сцена не загрузилась, но текст атласа читается.';
  document.body.appendChild(p);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x020104, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 220);

const shared = {
  uTime: { value: 0 },
  uFogFar: { value: 85 },
};

/* =========================================================
   shaders
   ========================================================= */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

/* Generic neon "fresnel" material, supports InstancedMesh + instanceColor. */
function glowMaterial({
  rim, core = col('#000000'), power = 2.4, intensity = 1, opacity = 1,
  transparent = false, additive = false, lit = 0.6, depthWrite = true, side = THREE.FrontSide,
}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uRim: { value: rim.clone() },
      uCore: { value: core.clone() },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uLit: { value: lit },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vTint;
      void main(){
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n);
        vV = normalize(-mv.xyz);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim; uniform vec3 uCore; uniform float uPower; uniform float uIntensity;
      uniform float uOpacity; uniform float uLit; uniform float uFogFar;
      varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vTint;
      void main(){
        vec3 N = normalize(vN);
        float f = pow(1.0 - abs(dot(N, normalize(vV))), uPower);
        float l = max(dot(N, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
        vec3 c = uCore * mix(1.0, 0.25 + l, uLit) + uRim * vTint * f * 1.6;
        float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, vDepth);
        gl_FragColor = vec4(c * uIntensity * fog, uOpacity * mix(0.35, 1.0, f));
      }`,
    transparent,
    depthWrite,
    side,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/* Soft round points, colour per vertex, optional size per vertex. */
function pointsMaterial({ size = 1, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uSize: { value: size },
      uOpacity: { value: opacity },
      uPixel: { value: renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float aSize;
      uniform float uSize; uniform float uPixel;
      varying vec3 vColor; varying float vDepth;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_PointSize = uSize * aSize * uPixel * (60.0 / max(vDepth, 0.1));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform float uFogFar;
      varying vec3 vColor; varying float vDepth;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, vDepth);
        gl_FragColor = vec4(vColor * a * uOpacity * fog, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makePoints(n, sizeFn = () => 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = sizeFn(i);
  g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

/* =========================================================
   geometry of the story
   ========================================================= */
const R = 4.0;                                 // T-cell radius
const UP = V(0, 1, 0);
const d = V(0.5, 0.35, 0.8).normalize();       // docking direction
const side = V().crossVectors(UP, d).normalize();
const upv = V().crossVectors(d, side).normalize();
const D = d.clone().multiplyScalar(R);         // docking point on membrane
const at = (k, s = 0, u = 0, base = D) => base.clone().addScaledVector(d, k).addScaledVector(side, s).addScaledVector(upv, u);

/* =========================================================
   blood plasma dust
   ========================================================= */
const DUST = isMobile ? 1800 : 3500;
const dustGeo = makePoints(DUST, () => rr(0.4, 1.6));
{
  const p = dustGeo.attributes.position.array;
  const c = dustGeo.attributes.color.array;
  for (let i = 0; i < DUST; i++) {
    p[i * 3] = rr(-60, 60);
    p[i * 3 + 1] = rr(-28, 28);
    p[i * 3 + 2] = rr(-50, 30);
    const k = rand();
    const cc = k < 0.55 ? C.red : k < 0.7 ? C.mag : C.violet;
    const b = rr(0.25, 0.9);
    c[i * 3] = cc.r * b; c[i * 3 + 1] = cc.g * b; c[i * 3 + 2] = cc.b * b;
  }
}
const dustMat = pointsMaterial({ size: 0.9, opacity: 0.9 });
dustMat.vertexShader = dustMat.vertexShader
  .replace('void main(){', 'void main(){\n vec3 pp = position; pp.x = mod(pp.x + uTime * 1.2 + 60.0, 120.0) - 60.0; pp.y += sin(uTime*0.3 + position.z)*0.4;')
  .replace('vec4(position, 1.0)', 'vec4(pp, 1.0)')
  .replace('uniform float uSize;', 'uniform float uSize; uniform float uTime;');
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);

/* =========================================================
   erythrocytes (biconcave discs, Evans–Fung profile)
   ========================================================= */
function rbcGeometry() {
  const pts = [];
  const C0 = 0.2072, C2 = 2.0026, C4 = -1.1228;
  const N = 28;
  const h = (x) => 0.5 * Math.sqrt(Math.max(0, 1 - x * x)) * (C0 + C2 * x * x + C4 * x ** 4);
  for (let i = 0; i <= N; i++) { const x = Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(x, 0.0001), h(x))); }
  for (let i = N - 1; i >= 0; i--) { const x = Math.sin((i / N) * Math.PI / 2); pts.push(new THREE.Vector2(Math.max(x, 0.0001), -h(x))); }
  const g = new THREE.LatheGeometry(pts, 48);
  g.computeVertexNormals();
  return g;
}
const RBC = isMobile ? 170 : 280;
const rbcMat = glowMaterial({ rim: C.red, core: col('#1c0204'), power: 2.2, intensity: 0.7, lit: 0.9 });
const rbc = new THREE.InstancedMesh(rbcGeometry(), rbcMat, RBC);
rbc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
rbc.frustumCulled = false;
const rbcData = [];
for (let i = 0; i < RBC; i++) {
  rbcData.push({
    p: V(rr(-70, 70), rr(-26, 26), rr(-55, 24)),
    speed: rr(1.6, 3.4),
    axis: V(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize(),
    spin: rr(0.15, 0.7) * (rand() < 0.5 ? -1 : 1),
    phase: rr(0, 100),
    s: rr(1.45, 2.0),
  });
  const k = rr(0.55, 1.1);
  rbc.setColorAt(i, new THREE.Color(k, k * rr(0.85, 1), k));
}
scene.add(rbc);

/* =========================================================
   CD4 T-lymphocyte
   ========================================================= */
const cell = new THREE.Group();
scene.add(cell);

const cellMat = new THREE.ShaderMaterial({
  uniforms: {
    ...shared,
    uRim: { value: C.cyan.clone() },
    uCore: { value: C.deepCyan.clone() },
    uSee: { value: 1 },
    uDockDir: { value: d.clone() },
    uDockColor: { value: C.lime.clone() },
    uDockGlow: { value: 0 },
    uOpacity: { value: 1 },
    uAmp: { value: 0.14 },
  },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uAmp;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying float vNoise; varying float vDepth;
    ${NOISE}
    void main(){
      vec3 nrm = normalize(position);
      float n = snoise(nrm * 1.4 + vec3(uTime * 0.07)) * 0.65 + snoise(nrm * 4.2 - vec3(uTime * 0.11)) * 0.35;
      vec3 pos = position + normal * n * uAmp;
      vNoise = n; vObj = nrm;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uRim; uniform vec3 uCore; uniform vec3 uDockDir; uniform vec3 uDockColor;
    uniform float uDockGlow; uniform float uOpacity; uniform float uTime; uniform float uFogFar; uniform float uSee;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying float vNoise; varying float vDepth;
    void main(){
      vec3 N = normalize(vN);
      float f = pow(1.0 - abs(dot(N, normalize(vV))), 2.1);
      float l = max(dot(N, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
      // topographic contour lines across the membrane
      float band = fract(vNoise * 7.0 + uTime * 0.05);
      float lines = smoothstep(0.0, 0.04, band) * (1.0 - smoothstep(0.06, 0.12, band));
      vec3 c = uCore * (0.3 + 0.7 * l) * uSee + uRim * f * mix(0.35, 0.85, uSee) + uRim * lines * 0.22 * uSee;
      float dk = smoothstep(0.955, 1.0, dot(vObj, uDockDir));
      float ring = smoothstep(0.93, 0.955, dot(vObj, uDockDir)) * (1.0 - dk);
      c += uDockColor * (dk * 0.55 + ring * 0.35) * uDockGlow * (0.8 + 0.2 * sin(uTime * 7.0));
      float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, vDepth);
      float a = mix(uOpacity, 1.0, clamp(f * 1.1 * mix(0.55, 1.0, uSee) + lines * 0.35 * uSee + dk * uDockGlow, 0.0, 1.0));
      gl_FragColor = vec4(c * fog, a);
    }`,
  transparent: true,
  depthWrite: false,
});
const membrane = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 48), cellMat);
membrane.renderOrder = 10;
cell.add(membrane);

// CD4 receptors — stalks + glowing tips
const REC_LEN = 0.38, TIP_R = 0.075;
const recDirs = [d.clone()];
for (const v of fibonacciSphere(isMobile ? 170 : 260)) if (v.angleTo(d) > 0.22) recDirs.push(v);
const stalkGeo = new THREE.CylinderGeometry(0.018, 0.028, REC_LEN, 6).translate(0, REC_LEN / 2, 0);
const tipGeo = new THREE.IcosahedronGeometry(TIP_R, 1).translate(0, REC_LEN, 0);
const recStalks = new THREE.InstancedMesh(stalkGeo, glowMaterial({ rim: C.cyan, core: col('#141311'), power: 1.2, intensity: 0.6 }), recDirs.length);
const recTips = new THREE.InstancedMesh(tipGeo, glowMaterial({ rim: C.cyan, core: col('#4a4740'), power: 1.0, intensity: 0.75, lit: 0.2 }), recDirs.length);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  recDirs.forEach((dir, i) => {
    q.setFromUnitVectors(UP, dir);
    const s = i === 0 ? 1.15 : rr(0.75, 1.1);
    m.compose(dir.clone().multiplyScalar(R - 0.04), q, V(s, s, s));
    recStalks.setMatrixAt(i, m);
    recTips.setMatrixAt(i, m);
    recTips.setColorAt(i, C.white);
    recStalks.setColorAt(i, C.white);
  });
}
cell.add(recStalks, recTips);

// CCR5 co-receptor: seven transmembrane helices in a ring, next to the dock
const d2 = d.clone().addScaledVector(side, -0.3).addScaledVector(upv, -0.06).normalize();
const ccr5 = new THREE.Group();
{
  const mat = glowMaterial({ rim: C.mag, core: col('#2a0206'), power: 1.2, intensity: 0.8 });
  const g = new THREE.CylinderGeometry(0.035, 0.035, 0.46, 8);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = new THREE.Mesh(g, mat);
    h.position.set(Math.cos(a) * 0.09, 0.12, Math.sin(a) * 0.09);
    h.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25);
    ccr5.add(h);
  }
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), mat);
  cap.position.y = 0.38;
  ccr5.add(cap);
  ccr5.quaternion.setFromUnitVectors(UP, d2);
}
cell.add(ccr5);

// nucleus + chromatin
const nucleusMat = glowMaterial({ rim: C.violet, core: col('#0c0b0a'), power: 1.6, intensity: 0.8, opacity: 0, transparent: true, additive: true, depthWrite: false, lit: 0.3 });
const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 12), nucleusMat);
nucleus.renderOrder = 2;
cell.add(nucleus);

const CHROM = 1600;
const chromGeo = makePoints(CHROM, () => rr(0.5, 1.1));
const chromBase = [];
{
  const p = chromGeo.attributes.position.array;
  for (let i = 0; i < CHROM; i++) {
    const s = i / CHROM;
    const a = s * Math.PI * 2;
    // a knotted curve folded inside the nucleus, with a double-helix twist
    const cx = Math.sin(a * 3) * 0.9 + Math.cos(a * 7) * 0.3;
    const cy = Math.cos(a * 4) * 0.8 + Math.sin(a * 9) * 0.2;
    const cz = Math.sin(a * 5 + 1) * 0.85;
    const tw = s * 380 + (i % 2) * Math.PI;
    p[i * 3] = cx + Math.cos(tw) * 0.06;
    p[i * 3 + 1] = cy + Math.sin(tw) * 0.06;
    p[i * 3 + 2] = cz + Math.cos(tw + 1.3) * 0.06;
    chromBase.push(s);
  }
}
const chromMat = pointsMaterial({ size: 0.9, opacity: 0 });
const chromatin = new THREE.Points(chromGeo, chromMat);
chromatin.renderOrder = 3;
cell.add(chromatin);

/* =========================================================
   HIV virion
   ========================================================= */
const VR = 0.9;
const virus = new THREE.Group();
scene.add(virus);

const envMat = new THREE.ShaderMaterial({
  uniforms: { ...shared, uOpacity: { value: 1 }, uRim: { value: C.mag.clone() } },
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vN; varying vec3 vV; varying float vN2; varying float vDepth;
    ${NOISE}
    void main(){
      float n = snoise(normal * 3.0 + vec3(uTime * 0.3));
      vN2 = n;
      vec3 pos = position + normal * n * 0.035;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uOpacity; uniform vec3 uRim; uniform float uFogFar;
    varying vec3 vN; varying vec3 vV; varying float vN2; varying float vDepth;
    void main(){
      float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
      vec3 c = uRim * (f * 1.5 + 0.06 + max(vN2, 0.0) * 0.2);
      float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, vDepth);
      gl_FragColor = vec4(c * fog, uOpacity * clamp(f * 1.2 + 0.08, 0.0, 1.0));
    }`,
  transparent: true,
  depthWrite: false,
});
const envelope = new THREE.Mesh(new THREE.IcosahedronGeometry(VR, 20), envMat);
envelope.renderOrder = 13;
virus.add(envelope);

const latticeMat = new THREE.LineBasicMaterial({ color: C.mag, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
const lattice = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(VR * 0.9, 2)), latticeMat);
lattice.renderOrder = 12;
virus.add(lattice);

// Env spikes: ~14 trimers per virion; spike #0 points to the cell (+Z local)
const SPIKES = 14;
const spikeDirs = fibonacciSphere(SPIKES);
{
  const q = new THREE.Quaternion().setFromUnitVectors(spikeDirs[0].clone(), V(0, 0, 1));
  spikeDirs.forEach((v) => v.applyQuaternion(q));
}
const spikeGroup = new THREE.Group();
virus.add(spikeGroup);
const spikeMat = glowMaterial({ rim: C.lime, core: col('#24211d'), power: 1.1, intensity: 0.7, transparent: true });
const spikeStalk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.045, 0.22, 6), spikeMat, SPIKES);
const spikeHead = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.075, 1), spikeMat, SPIKES * 3);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  spikeDirs.forEach((dir, i) => {
    q.setFromUnitVectors(UP, dir);
    m.compose(dir.clone().multiplyScalar(VR + 0.1), q, V(1, 1, 1));
    spikeStalk.setMatrixAt(i, m);
    spikeStalk.setColorAt(i, C.white);
    const t1 = V(1, 0, 0).applyQuaternion(q), t2 = V(0, 0, 1).applyQuaternion(q);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const pos = dir.clone().multiplyScalar(VR + 0.27).addScaledVector(t1, Math.cos(a) * 0.065).addScaledVector(t2, Math.sin(a) * 0.065);
      m.compose(pos, q, V(1, 1, 1));
      spikeHead.setMatrixAt(i * 3 + k, m);
      spikeHead.setColorAt(i * 3 + k, C.white);
    }
  });
}
spikeGroup.add(spikeStalk, spikeHead);
const DOCK_DIST = R + REC_LEN * 1.15 + TIP_R + 0.34 + VR - 0.06; // centre of a docked virion, along d

// conical capsid (fullerene cone) — travels on its own after fusion
const capsid = new THREE.Group();
{
  const g = new THREE.ConeGeometry(0.3, 0.9, 12, 5, true).rotateX(Math.PI / 2);
  const inner = new THREE.Mesh(g, glowMaterial({ rim: C.gold, core: col('#1a1814'), power: 1.4, intensity: 0.7, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: C.gold, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12).translate(0, 0, -0.45), inner.material);
  capsid.add(inner, wire, cap);
  // two copies of RNA genome inside
  const rnaGeo = makePoints(80, () => 0.7);
  const p = rnaGeo.attributes.position.array, c = rnaGeo.attributes.color.array;
  for (let i = 0; i < 80; i++) {
    const s = (i % 40) / 40, strand = i < 40 ? 1 : -1;
    const z = lerp(-0.38, 0.3, s);
    const rad = lerp(0.2, 0.05, s);
    p[i * 3] = Math.cos(s * 14) * rad * 0.6 + strand * 0.03;
    p[i * 3 + 1] = Math.sin(s * 14) * rad * 0.6;
    p[i * 3 + 2] = z;
    c[i * 3] = C.mag.r; c[i * 3 + 1] = C.mag.g; c[i * 3 + 2] = C.mag.b;
  }
  capsid.add(new THREE.Points(rnaGeo, pointsMaterial({ size: 0.25 })));
}
capsid.traverse((o) => { o.renderOrder = 11; });
scene.add(capsid);

/* gp41 "harpoons" */
const harpoonGeo = new THREE.BufferGeometry();
harpoonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
const harpoonMat = new THREE.LineBasicMaterial({ color: C.lime, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const harpoons = new THREE.LineSegments(harpoonGeo, harpoonMat);
harpoons.frustumCulled = false;
scene.add(harpoons);

/* contact flash */
const flashMat = new THREE.SpriteMaterial({ map: GLOW, color: C.white, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const flash = new THREE.Sprite(flashMat);
flash.renderOrder = 20;
scene.add(flash);

/* fusion burst */
const BURST = 700;
const burstGeo = makePoints(BURST, () => rr(0.4, 1.4));
const burstDirs = [];
for (let i = 0; i < BURST; i++) {
  const v = V(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
  if (v.dot(d) < 0) v.addScaledVector(d, -2 * v.dot(d));
  burstDirs.push({ v, s: rr(0.6, 3.4), c: rand() < 0.75 ? C.mag : C.white });
}
const burst = new THREE.Points(burstGeo, pointsMaterial({ size: 0.5 }));
burst.frustumCulled = false;
scene.add(burst);

/* reverse-transcription trail: RNA (magenta) turning into double-stranded DNA (gold) */
const TRAIL = 900;
const trailGeo = makePoints(TRAIL, () => rr(0.6, 1.1));
const trail = new THREE.Points(trailGeo, pointsMaterial({ size: 0.45 }));
trail.frustumCulled = false;
trail.renderOrder = 11;
scene.add(trail);

/* budding progeny virions — each one slightly different */
const BUDS = isMobile ? 55 : 90;
const budMat = glowMaterial({ rim: C.white, core: col('#120203'), power: 1.8, intensity: 0.75 });
const buds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.34, 3), budMat, BUDS);
buds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
buds.frustumCulled = false;
const budData = [];
{
  const dirs = fibonacciSphere(BUDS);
  for (let i = 0; i < BUDS; i++) {
    const mutant = rand() < 0.22;
        budData.push({
      dir: dirs[i].clone().add(V(rr(-0.1, 0.1), rr(-0.1, 0.1), rr(-0.1, 0.1))).normalize(),
      birth: rr(7.45, 8.1),
      dist: rr(3, 11),
      wob: rr(0, 10),
      kill: rr(8.85, 9.55),
      s: rr(0.75, 1.15),
    });
    buds.setColorAt(i, mutant ? new THREE.Color(0.95, 0.92, 0.85) : new THREE.Color().setHSL(0.99, rr(0.75, 1), rr(0.35, 0.55)));
    budData[i].mutant = mutant;
    budData[i].pos = V();
  }
}
scene.add(buds);

/* antiretroviral drugs — five colour-coded classes swarming the scene */
const DRUGS = isMobile ? 1300 : 2400;
const drugGeo = makePoints(DRUGS, () => rr(0.5, 1.5));
const drugData = new Float32Array(DRUGS * 4);
{
  const c = drugGeo.attributes.color.array;
  const classes = [C.white, C.cyan, col('#b8b2a4'), C.white, col('#8c877d')];
  for (let i = 0; i < DRUGS; i++) {
    drugData[i * 4] = rr(R + 0.8, R + 12);
    drugData[i * 4 + 1] = rr(0, Math.PI * 2);
    drugData[i * 4 + 2] = Math.acos(rr(-1, 1));
    drugData[i * 4 + 3] = rr(0.05, 0.25) * (rand() < 0.5 ? -1 : 1);
    const cc = classes[i % 5];
    c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
  }
}
const drugMat = pointsMaterial({ size: 1.0, opacity: 0 });
const drugs = new THREE.Points(drugGeo, drugMat);
drugs.frustumCulled = false;
scene.add(drugs);

/* =========================================================
   camera path — one key per chapter
   ========================================================= */
const KEYS = [
  { p: V(0, 3, 36), t: V(-7, 0.5, 0) },
  { p: V(-4.5, 1.5, 13.5), t: V(0.6, 0, 0) },
  { p: at(8.5, 3.6, 1.3), t: at(2.4, -1.4) },
  { p: at(5.4, 2.8, 1.0), t: at(1.1) },
  { p: at(5.0, -3.2, 1.6), t: at(0.9, 0.3) },
  { p: at(6.2, 0.9, 2.8), t: at(0.4, 1.5, 0.3) },
  { p: at(9.5, 4.2, 2.6, V()), t: at(2.3, 0, 0, V()) },
  { p: at(7.2, -3.6, 1.6, V()), t: at(0.5, 0, 0, V()) },
  { p: V(0, 5, 22), t: V(0, 0, 0) },
  { p: V(7, -2.5, 18.5), t: V(0, 0.4, 0) },
  { p: V(0, 8, 44), t: V(-11, 1, 0) },
];
const LAST = KEYS.length - 1;
const camCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.p), false, 'centripetal');

/* virion path pieces */
const FAR = at(17, -13, 8);
const HOVER = at(3.3);
const DOCK = d.clone().multiplyScalar(DOCK_DIST);
const FUSED = at(0.15);
const qDock = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().negate());
const tumbleAxis = V(0.3, 1, 0.2).normalize();
const NUC_ENTRY = d.clone().multiplyScalar(1.85);

function capsidPath(u, out = V()) {
  out.lerpVectors(FUSED, NUC_ENTRY, u);
  const b = Math.sin(u * Math.PI);
  return out.addScaledVector(side, b * 0.7).addScaledVector(upv, b * 0.35);
}

/* =========================================================
   post-processing
   ========================================================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.55, 0.22);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- glyph atlas: density ramp built from nucleotides ---------- */
const RAMP = ' .,:-~=+*cgauCGAU#%@';
function buildGlyphs() {
  const gw = 32, gh = Math.round(32 * 1.7);
  const cv = document.createElement('canvas');
  cv.width = gw * RAMP.length; cv.height = gh;
  const x = cv.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `400 ${Math.round(gh * 0.72)}px "PT Mono", ui-monospace, monospace`;
  for (let i = 0; i < RAMP.length; i++) x.fillText(RAMP[i], i * gw + gw / 2, gh * 0.54);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

/* ---------- style pass: ASCII ⇄ engraving, microscope lens, invert flash ---------- */
const styleU = {
  tDiffuse: { value: null },
  tGlyphs: { value: buildGlyphs() },
  uGlyphs: { value: RAMP.length },
  uRes: { value: new THREE.Vector2(1, 1) },
  uCell: { value: 9 },
  uMode: { value: 0 },
  uTime: { value: 0 },
  uMouse: { value: new THREE.Vector2(-999, -999) },
  uLens: { value: 0 },
  uInvert: { value: 0 },
  uGlitch: { value: 0 },
  uDim: { value: 0 },
  uBone: { value: new THREE.Vector3(0.94, 0.94, 0.94) },
  uBlood: { value: new THREE.Vector3(0.94, 0.94, 0.94) },
};
const stylePass = new ShaderPass({
  uniforms: styleU,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tGlyphs;
    uniform float uGlyphs; uniform vec2 uRes; uniform float uCell; uniform float uMode; uniform float uTime;
    uniform vec2 uMouse; uniform float uLens; uniform float uInvert; uniform float uGlitch; uniform float uDim;
    uniform vec3 uBone; uniform vec3 uBlood;
    varying vec2 vUv;

    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    float redness(vec3 c){ return smoothstep(0.35, 0.7, (c.r - max(c.g, c.b)) / max(c.r, 0.04)); }
    vec3 tint(vec3 c){ return mix(uBone, uBlood, redness(c)); }

    vec3 ascii(vec2 px, float cell){
      vec2 cs = vec2(cell, cell * 1.7);
      // typewriter carriage: every row lands a little off
      float row = floor(px.y / cs.y);
      px.x += (hash(vec2(row, 3.1)) - 0.5) * cell * 0.6;
      vec2 id = floor(px / cs);
      float gl = step(0.85, hash(vec2(id.y, floor(uTime * 16.0)))) * uGlitch;
      id.x += floor((hash(vec2(id.y * 1.7, floor(uTime * 23.0))) - 0.5) * 18.0 * gl);
      vec2 c = (id + 0.5) * cs / uRes;
      vec2 o = cs / uRes * 0.25;
      vec3 s = texture2D(tDiffuse, c).rgb * 0.4
        + (texture2D(tDiffuse, c + o).rgb + texture2D(tDiffuse, c - o).rgb
         + texture2D(tDiffuse, c + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, c + vec2(-o.x, o.y)).rgb) * 0.15;
      float l = pow(smoothstep(0.02, 0.9, luma(s)), 1.15);
      float gi = floor(l * (uGlyphs - 0.001));
      // each key strikes a bit off-centre and with its own amount of ink
      vec2 lp = fract(px / cs) + (vec2(hash(id + 1.3), hash(id + 7.9)) - 0.5) * vec2(0.18, 0.12);
      float g = texture2D(tGlyphs, vec2((gi + clamp(lp.x, 0.0, 1.0)) / uGlyphs, clamp(lp.y, 0.0, 1.0))).r;
      g *= mix(0.45, 1.15, hash(id * 0.71 + 2.0));
      g *= step(0.05, hash(id + floor(uTime * 0.5) * 0.37));
      // black & white: blood and virus are printed in inverse video (lit cell, black glyph)
      float r = redness(s);
      vec3 normal = uBone * g * (0.3 + 0.8 * l);
      vec3 inverse = uBone * (1.0 - g) * clamp(0.18 + l * 1.3, 0.0, 0.92);
      return mix(normal, inverse, step(0.5, r) * step(0.34, luma(s)));
    }

    float hatch(vec2 p, float a, float sp, float w){
      float v = dot(p, vec2(cos(a), sin(a))) / sp;
      float d = abs(fract(v) - 0.5);
      return clamp((w - d) / 0.09 + 0.5, 0.0, 1.0) * step(0.004, w);
    }

    vec3 engrave(vec2 px){
      vec3 s = texture2D(tDiffuse, vUv).rgb;
      float l = pow(smoothstep(0.02, 0.95, luma(s)), 1.2);
      vec2 p = px + vec2(sin(px.y * 0.043 + uTime * 0.35), sin(px.x * 0.037 - uTime * 0.2)) * 1.6;
      float sp = uCell * 0.62;
      float ink = hatch(p, 0.785, sp, clamp((l - 0.05) * 0.8, 0.0, 0.4));
      ink = max(ink, hatch(p, -0.785, sp, clamp((l - 0.3) * 0.8, 0.0, 0.4)));
      ink = max(ink, hatch(p, 0.0, sp * 0.7, clamp((l - 0.55) * 0.9, 0.0, 0.42)));
      ink = max(ink, smoothstep(0.93, 1.0, l) * 0.8);
      // stipple the darkness
      ink = max(ink, step(hash(floor(px / 2.0) + floor(uTime * 6.0) * 0.01), l * 0.25) * 0.7);
      // pen outlines (Sobel)
      vec2 e = 1.5 / uRes;
      float tl = luma(texture2D(tDiffuse, vUv + vec2(-e.x, e.y)).rgb), tr = luma(texture2D(tDiffuse, vUv + e).rgb);
      float bl = luma(texture2D(tDiffuse, vUv - e).rgb), br = luma(texture2D(tDiffuse, vUv + vec2(e.x, -e.y)).rgb);
      float t = luma(texture2D(tDiffuse, vUv + vec2(0.0, e.y)).rgb), b = luma(texture2D(tDiffuse, vUv - vec2(0.0, e.y)).rgb);
      float lf = luma(texture2D(tDiffuse, vUv - vec2(e.x, 0.0)).rgb), rt = luma(texture2D(tDiffuse, vUv + vec2(e.x, 0.0)).rgb);
      float gx = (tr + 2.0 * rt + br) - (tl + 2.0 * lf + bl);
      float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
      ink = max(ink, smoothstep(0.1, 0.35, length(vec2(gx, gy))));
      // blood and virus: halftone dots instead of hatching
      vec2 q = fract(p / (sp * 1.05)) - 0.5;
      float dr = sqrt(l) * 0.62;
      float tone = max(1.0 - smoothstep(dr - 0.07, dr, length(q)), smoothstep(0.1, 0.35, length(vec2(gx, gy))));
      ink = mix(ink, tone, step(0.5, redness(s)) * step(0.3, luma(s)));
      return uBone * ink * (0.4 + 0.6 * l);
    }

    vec3 raw(vec3 s){
      float l = luma(s);
      return uBone * pow(l, 0.85) * 1.2;
    }

    void main(){
      vec2 px = vUv * uRes;
      vec2 cs = vec2(uCell, uCell * 1.7);
      float dis = uMode > hash(floor(px / cs) + 0.37) ? 1.0 : 0.0;
      // gate weave: the whole print shivers a pixel or two
      float wf = floor(uTime * 12.0);
      px += (vec2(hash(vec2(wf, 1.0)), hash(vec2(wf, 2.0))) - 0.5) * 2.2;
      vec3 col = dis > 0.5 ? engrave(px) : ascii(px, uCell);
      // misregistered second pass of the copier
      if (dis < 0.5) col += ascii(px + vec2(3.0, -2.0), uCell) * 0.22;

      // microscope lens under the cursor: the "true" specimen, magnified
      float dm = distance(px, uMouse);
      if (uLens > 1.0) {
        float inL = 1.0 - smoothstep(uLens - 1.5, uLens, dm);
        if (inL > 0.0) {
          vec2 uvL = (uMouse + (px - uMouse) * 0.5) / uRes;
          col = mix(col, raw(texture2D(tDiffuse, uvL).rgb), inL);
        }
        float ring = 1.0 - smoothstep(0.0, 1.3, abs(dm - uLens));
        vec2 dv = abs(px - uMouse);
        float tick = step(dm, uLens + 10.0) * step(uLens + 2.0, dm) * step(min(dv.x, dv.y), 0.8);
        col = mix(col, uBone * 0.85, max(ring, tick) * 0.9);
      }

      col = mix(col, uBone * 0.92 - col * 0.9, uInvert);
      // film scratches and dust
      float sf = floor(uTime * 5.0);
      for (int k = 0; k < 2; k++) {
        float sx = hash(vec2(sf, float(k) * 9.1)) * uRes.x;
        float on = step(0.55, hash(vec2(sf, float(k) + 4.4)));
        col += uBone * 0.35 * on * (1.0 - smoothstep(0.0, 1.2, abs(px.x - sx + sin(px.y * 0.01 + sf) * 3.0)));
      }
      col += uBone * 0.6 * step(0.99965, hash(floor(px / 3.0) + floor(uTime * 9.0)));
      col *= 1.0 - uDim * 0.65;
      col += (hash(px + fract(uTime) * 91.7) - 0.5) * 0.045;
      vec2 cc = vUv - 0.5;
      col *= 1.0 - smoothstep(0.08, 0.5, dot(cc, cc)) * 0.75;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
stylePass.uniforms = styleU;
stylePass.material.uniforms = styleU;
composer.addPass(stylePass);

/* =========================================================
   scroll + UI
   ========================================================= */
const chapters = [...document.querySelectorAll('.chapter')];
const rail = document.getElementById('rail');
const navItems = [...document.querySelectorAll('[data-roman]')];
const railBtns = navItems.map((el, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<span>${el.dataset.title}</span><em>${el.dataset.roman}</em>`;
  b.setAttribute('aria-label', `${el.classList.contains('appx') ? 'Приложение' : 'Глава'} ${el.dataset.roman}: ${el.dataset.title}`);
  b.addEventListener('click', () => goToEl(el));
  if (i === chapters.length) b.style.marginTop = '12px';
  rail.appendChild(b);
  return b;
});
function goToEl(el) {
  const top = el.classList.contains('chapter') ? el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2 : el.offsetTop - window.innerHeight * 0.08;
  window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
}
function goTo(i) { goToEl(chapters[i]); }
document.getElementById('again').addEventListener('click', () => goTo(0));
document.getElementById('again2').addEventListener('click', () => goTo(0));

let tTarget = 0, tNow = 0;
function readScroll() {
  const h = chapters[0].offsetHeight;
  const y = window.scrollY + window.innerHeight / 2 - h / 2;
  tTarget = clamp(y / h, 0, LAST);
}
let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  readScroll();
  const dy = Math.abs(window.scrollY - lastScrollY);
  lastScrollY = window.scrollY;
  if (typeof glitch === 'number') glitch = Math.max(glitch, Math.min(0.7, dy / 500));
}, { passive: true });

const mouse = { x: 0, y: 0, sx: 0, sy: 0, px: -999, py: -999, fine: false };
const lensTag = document.getElementById('lensTag');
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  mouse.px = e.clientX; mouse.py = e.clientY;
  mouse.fine = e.pointerType === 'mouse';
});
document.addEventListener('pointerleave', () => { mouse.fine = false; });

/* ---------- optics toggle: ASCII / engraving ---------- */
let modeTarget = 0, glitch = 0;
const modeBtns = [...document.querySelectorAll('.modes button')];
function setMode(m) {
  modeTarget = m;
  modeBtns.forEach((b) => { const on = +b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  glitch = 1;
  try { localStorage.setItem('haema-mode', String(m)); } catch (e) { /* storage blocked */ }
}
modeBtns.forEach((b) => b.addEventListener('click', () => setMode(+b.dataset.mode)));
try { const m = localStorage.getItem('haema-mode'); if (m === '1') { setMode(1); styleU.uMode.value = 1; } } catch (e) { /* storage blocked */ }

let lensKey = '';
function updateStyle(time, dt, mdt = dt) {
  styleU.uTime.value = time;
  const m = styleU.uMode.value;
  styleU.uMode.value = m + clamp(modeTarget - m, -mdt * 1.1, mdt * 1.1);
  glitch *= Math.exp(-dt * 3.5);
  styleU.uGlitch.value = reduceMotion ? 0 : glitch;
  const pr = renderer.getPixelRatio();
  const lensOn = mouse.fine && !isMobile;
  const target = lensOn ? 92 * pr : 0;
  styleU.uLens.value += (target - styleU.uLens.value) * Math.min(1, dt * 8);
  styleU.uMouse.value.set(mouse.px * pr, (window.innerHeight - mouse.py) * pr);
  document.body.classList.toggle('lens', lensOn);
  if (lensOn) {
    lensTag.style.transform = `translate(${mouse.px + 70}px, ${mouse.py + 74}px)`;
    const key = `${mouse.px | 0}:${mouse.py | 0}`;
    if (key !== lensKey) {
      lensKey = key;
      lensTag.innerHTML = `×400 · x ${String(mouse.px | 0).padStart(4, '0')} y ${String(mouse.py | 0).padStart(4, '0')}<br><i>sub microscopio</i>`;
    }
  }
}

/* ---------- blood-drip progress ---------- */
const dripFill = document.getElementById('dripFill'), dripDrop = document.getElementById('dripDrop');

/* ---------- viral load HUD ---------- */
const hud = document.getElementById('hudLoad');
const vl = document.getElementById('vl');
const vlBar = document.getElementById('vlBar');
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
let lastVl = '';

/* ---------- mutating genome ticker ---------- */
const genomeEl = document.getElementById('genome');
const BASES = 'ACGU';
const GLEN = isMobile ? 96 : 144;
const genome = Array.from({ length: GLEN }, () => BASES[(rand() * 4) | 0]);
const mutAt = new Float32Array(GLEN).fill(-99);
function renderGenome(now) {
  let html = '';
  for (let i = 0; i < GLEN; i++) html += now - mutAt[i] < 1.6 ? `<span class="m">${genome[i]}</span>` : genome[i];
  genomeEl.innerHTML = html;
}
let genomeTick = 0;

/* ---------- reverse transcription ticker ---------- */
const rtEl = document.getElementById('rtDiagram');
const COMP = { A: 'T', U: 'A', G: 'C', C: 'G' };
const RT_W = isMobile ? 18 : 24;
const rna = Array.from({ length: 400 }, () => BASES[(rand() * 4) | 0]);
let rtTick = 0, rtHead = 0;
function renderRT() {
  const start = Math.max(0, rtHead - RT_W + 4);
  let top = '', a = '', m = '', bot = '';
  for (let k = 0; k < RT_W; k++) {
    const i = start + k;
    const here = i === rtHead;
    top += here ? '<span class="d">v</span> ' : '  ';
    a += `<span class="m">${rna[i % rna.length]}</span>-`;
    m += i < rtHead ? '| ' : '  ';
    bot += i < rtHead ? `<span class="d">${COMP[rna[i % rna.length]]}</span>-` : '..';
  }
  rtEl.innerHTML = `      ${top}\nРНК 5'${a}3'\n      ${m}\nДНК 3'${bot}5'\n\n      <span class="d">v</span> — обратная транскриптаза, ${String(rtHead).padStart(4, '0')} нт`;
}

/* ---------- ASCII titles drawn from genome letters ---------- */
const titles = [
  { el: document.getElementById('t1'), text: 'Кровь' },
  { el: document.getElementById('t2'), text: 'и вирусы' },
  { el: document.getElementById('t3'), text: 'Н = Н', solo: true },
];
const TITLE_FONT = (px) => `900 ${px}px "Playfair Display", "Times New Roman", serif`;
// print each row slightly off-register and with uneven ink, like a worn stencil
function renderTitle(t) {
  const rows = t.chars.join('').split('\n');
  if (!t.rowFx || t.rowFx.length !== rows.length) t.rowFx = rows.map(() => [(rand() - 0.5) * 7, 0.62 + rand() * 0.38]);
  t.el.innerHTML = rows.map((row, i) => `<span class="ln" style="--x:${t.rowFx[i][0].toFixed(1)}px;--o:${t.rowFx[i][1].toFixed(2)}">${row || ' '}</span>`).join('');
}
function layoutTitles() {
  const cv = document.createElement('canvas');
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.font = TITLE_FONT(100);
  const widths = titles.map((t) => x.measureText(t.text).width);
  const maxW = Math.max(widths[0], widths[1]);
  const box = titles[0].el.parentElement.clientWidth || 600;
  const maxCols = window.innerWidth < 760 ? 70 : 132;
  // real advance of the page's mono font, so the ASCII letters keep their proportions
  x.font = `100px ${getComputedStyle(titles[0].el).fontFamily}`;
  const ADV = clamp(x.measureText('M').width / 100, 0.5, 0.8);
  const fontPx = box / (maxCols * ADV);
  const ASPECT = 1 / ADV;
  titles.forEach((t, k) => {
    const cols = Math.max(8, Math.round(maxCols * (t.solo ? 0.62 : widths[k] / maxW)));
    const F = (100 * cols) / widths[k];
    const rows = Math.ceil((F * 1.02) / ASPECT);
    const SS = 6; // supersample each character cell
    cv.width = cols * SS; cv.height = rows * SS;
    x.clearRect(0, 0, cv.width, cv.height);
    x.save(); x.scale(SS, SS / ASPECT);
    x.fillStyle = '#fff'; x.font = TITLE_FONT(F); x.textBaseline = 'alphabetic';
    x.fillText(t.text, 0, F * 0.8);
    x.restore();
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    t.chars = []; t.fill = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let yy = 0; yy < SS; yy++) for (let xx = 0; xx < SS; xx++) sum += d[((r * SS + yy) * cv.width + c * SS + xx) * 4 + 3];
        const a = sum / (SS * SS * 255);
        let ch = ' ';
        if (a > 0.55) { ch = BASES[(rand() * 4) | 0]; t.fill.push(t.chars.length); }
        else if (a > 0.3) ch = rand() < 0.5 ? '+' : '*';
        else if (a > 0.1) ch = rand() < 0.5 ? '.' : ':';
        t.chars.push(ch);
      }
      t.chars.push('\n');
    }
    t.el.style.fontSize = `${fontPx}px`;
    t.rowFx = null;
    renderTitle(t);
  });
}
if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load(TITLE_FONT(100), 'Кровь'),
    document.fonts.load('400 40px "PT Mono"', 'ACGUКровь'),
  ]).then(() => { layoutTitles(); styleU.tGlyphs.value = buildGlyphs(); }).catch(() => {});
}
let titleTick = 0;
function mutateTitles() {
  for (const t of titles) {
    if (!t.fill || !t.fill.length) continue;
    for (let k = 0; k < 6; k++) { const i = t.fill[(rand() * t.fill.length) | 0]; t.chars[i] = BASES[(rand() * 4) | 0]; }
    renderTitle(t);
  }
}

const spin = document.getElementById('spin');
const SPIN = '|/-\\';

let activeChapter = -1;
function updateUI(t, time) {
  const mid = window.innerHeight / 2;
  let idx = 0, bd = 1e9;
  navItems.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dd = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (dd < bd) { bd = dd; idx = i; }
  });
  if (idx !== activeChapter) {
    if (activeChapter !== -1) glitch = Math.max(glitch, 0.8);
    activeChapter = idx;
    railBtns.forEach((b, i) => b.classList.toggle('on', i === idx));
  }
  chapters.forEach((ch, i) => ch.classList.toggle('in', Math.abs(tTarget - i) < 0.62));

  const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const prog = (window.scrollY / docMax) * 100;
  // the archive dims the specimen behind it
  const fin = chapters[LAST];
  styleU.uDim.value = clamp((window.scrollY - (fin.offsetTop + fin.offsetHeight / 2 - window.innerHeight / 2)) / window.innerHeight);
  dripFill.style.height = `${prog}vh`;
  dripDrop.style.transform = `translateY(calc(${prog}vh - 4px))`;
  spin.textContent = SPIN[Math.floor(time * 6) % 4];

  const show = t > 7.4 && styleU.uDim.value < 0.25;
  hud.classList.toggle('on', show);
  if (show) {
    const rise = ss(7.45, 8.3, t), fall = ss(9.0, 9.85, t);
    const logV = lerp(lerp(1.5, 5.25, rise), 1.6, fall);
    const v = Math.pow(10, logV) * (1 + Math.sin(time * 3) * 0.015 * (1 - fall));
    const txt = fall > 0.97 ? '< 50' : fmt(v);
    if (txt !== lastVl) {
      vl.textContent = txt; lastVl = txt;
      const n = Math.round((logV / 6) * 24);
      vlBar.textContent = `[${'|'.repeat(n)}${'·'.repeat(24 - n)}] 10^${logV.toFixed(1)}`;
    }
    hud.classList.toggle('low', fall > 0.97);
  }

  if (Math.abs(tTarget - 8) < 0.7 && time - genomeTick > 0.11) {
    genomeTick = time;
    const i = (rand() * GLEN) | 0;
    let b;
    do { b = BASES[(rand() * 4) | 0]; } while (b === genome[i]);
    genome[i] = b;
    mutAt[i] = time;
    renderGenome(time);
  }
  if (Math.abs(tTarget - 6) < 0.7 && time - rtTick > 0.16) {
    rtTick = time; rtHead++; renderRT();
  }
  if ((tTarget < 0.8 || tTarget > LAST - 0.8) && time - titleTick > 0.12) {
    titleTick = time; mutateTitles();
  }
}
renderGenome(0);
renderRT();

/* =========================================================
   anatomical callouts — leader lines from 3D anchors
   ========================================================= */
const SVGNS = 'http://www.w3.org/2000/svg';
const leaders = document.getElementById('leaders');
const labelsEl = document.getElementById('labels');
let rbcPick = -1;
const _a = V(), _pp = V();
const toWorld = (obj) => _a.applyMatrix4(obj.matrixWorld);
const CALLOUTS = [
  { ch: 0, t: 'эритроцит', s: 'erythrocytus', oy: -70, get: () => pickRbc() },
  { ch: 1, t: 'CD4', s: 'receptor CD4', oy: -90, get: () => toWorld(cell, _a.copy(d).multiplyScalar(R + 0.45)) },
  { ch: 1, t: 'мембрана', s: 'membrana cellulae', oy: 80, get: () => toWorld(cell, _a.set(-0.35, -0.55, 0.76).normalize().multiplyScalar(R)) },
  { ch: 2, t: 'Env', s: 'gp120 · gp41', oy: -80, get: () => toWorld(virus, _a.copy(spikeDirs[4]).multiplyScalar(VR + 0.28)) },
  { ch: 2, t: 'капсид', s: 'capsida conica · p24', oy: 70, blood: false, get: () => _a.copy(capsid.position) },
  { ch: 2, t: 'оболочка', s: 'involucrum lipidicum', oy: 140, blood: true, get: () => toWorld(virus, _a.copy(spikeDirs[9]).multiplyScalar(VR)) },
  { ch: 3, t: 'контакт', s: 'gp120 ⟷ CD4', oy: -80, get: () => _a.copy(D).addScaledVector(d, 0.5) },
  { ch: 4, t: 'CCR5', s: 'coreceptor', oy: 90, blood: true, get: () => toWorld(cell, _a.copy(d2).multiplyScalar(R + 0.1)) },
  { ch: 5, t: 'пора слияния', s: 'porus fusionis', oy: -90, blood: true, get: () => _a.copy(D) },
  { ch: 6, t: 'капсид', s: 'iter ad nucleum', oy: -80, get: () => _a.copy(capsid.position) },
  { ch: 6, t: 'ядро', s: 'nucleus', oy: 90, get: () => toWorld(cell, _a.copy(upv).multiplyScalar(-1.75)) },
  { ch: 7, t: 'провирус', s: 'provirus', oy: -90, blood: true, get: () => chromPoint(Math.floor(CHROM * 0.14)) },
  { ch: 7, t: 'хроматин', s: 'chromatinum', oy: 90, get: () => chromPoint(Math.floor(CHROM * 0.62)) },
  { ch: 8, t: 'мутант', s: 'variatio', oy: -80, get: () => budPoint(true) },
  { ch: 8, t: 'новый вирион', s: 'virion novum', oy: 90, blood: true, get: () => budPoint(false) },
  { ch: 9, t: 'ингибитор', s: 'therapia', oy: -90, get: () => drugPoint(7) },
  { ch: 10, t: 'T-клетка', s: 'sub tutela', oy: -80, get: () => toWorld(cell, _a.set(0.3, 0.9, 0.3).normalize().multiplyScalar(R)) },
];
function chromPoint(i) { const p = chromGeo.attributes.position.array; return toWorld(chromatin, _a.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])); }
function drugPoint(i) { const p = drugGeo.attributes.position.array; return _a.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); }
function budPoint(mutant) {
  let best = null, bd = 1e9;
  for (const b of budData) {
    if (b.mutant !== mutant || !b.pos) continue;
    _pp.copy(b.pos).project(camera);
    const dd = Math.abs(_pp.x - (mutant ? 0.25 : 0.1)) + Math.abs(_pp.y - (mutant ? 0.35 : -0.35));
    if (_pp.z < 1 && dd < bd) { bd = dd; best = b; }
  }
  return best ? _a.copy(best.pos) : _a.set(0, 0, 0);
}
function pickRbc() {
  const ok = (i) => {
    if (i < 0) return false;
    _pp.copy(rbcData[i].pos || V(999, 0, 0)).project(camera);
    return _pp.z < 1 && _pp.x > 0.05 && _pp.x < 0.6 && _pp.y > -0.4 && _pp.y < 0.55 && rbcData[i].pos.distanceTo(camera.position) < 40;
  };
  if (!ok(rbcPick)) { rbcPick = -1; for (let i = 0; i < RBC; i++) if (ok(i)) { rbcPick = i; break; } }
  return rbcPick < 0 ? _a.set(0, 0, -999) : _a.copy(rbcData[rbcPick].pos);
}
CALLOUTS.forEach((c) => {
  c.g = document.createElementNS(SVGNS, 'g');
  if (c.blood) c.g.setAttribute('class', 'blood');
  c.line = document.createElementNS(SVGNS, 'path');
  c.dot = document.createElementNS(SVGNS, 'path');
  c.g.append(c.line, c.dot);
  leaders.appendChild(c.g);
  c.el = document.createElement('div');
  c.el.className = 'lbl' + (c.blood ? ' blood' : '');
  c.el.innerHTML = `${c.t}<i>${c.s}</i>`;
  labelsEl.appendChild(c.el);
});
function updateCallouts(t) {
  const w = window.innerWidth, h = window.innerHeight;
  for (const c of CALLOUTS) {
    let o = (1 - ss(0.22, 0.48, Math.abs(t - c.ch))) * (1 - ss(0.05, 0.25, styleU.uDim.value));
    if (o > 0.01) {
      c.get();
      _pp.copy(_a).project(camera);
      if (_pp.z > 1 || Math.abs(_pp.x) > 1.1 || Math.abs(_pp.y) > 1.1) o = 0;
    }
    if (o <= 0.01) { c.g.style.display = 'none'; c.el.style.display = 'none'; continue; }
    const ax = (_pp.x * 0.5 + 0.5) * w, ay = (-_pp.y * 0.5 + 0.5) * h;
    // leaders point away from the chapter card
    const cardRight = chapters[c.ch].classList.contains('right');
    const dir = isMobile ? (ax > w / 2 ? -1 : 1) : (cardRight ? -1 : 1);
    const oy = isMobile ? -Math.abs(c.oy) : c.oy;
    const ex = ax + dir * 46, ey = ay + oy, fx = ex + dir * 70;
    c.g.style.display = ''; c.el.style.display = '';
    c.g.style.opacity = o; c.el.style.opacity = o;
    // pen line that "boils" a few times a second, like hand-drawn animation
    const boil = Math.floor(performance.now() / 160);
    const pr = seeded(boil * 97 + CALLOUTS.indexOf(c) * 13);
    c.line.setAttribute('d', penPath(subdivide([[ax, ay], [ex, ey], [fx, ey]], 5), pr, 1.4));
    const ang = Math.atan2(ay - ey, ax - ex), hl = 11;
    c.dot.setAttribute('d', `M${ax - Math.cos(ang - 0.5) * hl} ${ay - Math.sin(ang - 0.5) * hl} L${ax} ${ay} L${ax - Math.cos(ang + 0.45) * hl} ${ay - Math.sin(ang + 0.45) * hl}`);
    c.el.classList.toggle('l', dir < 0);
    // keep the label on screen
    const lw = c.el.offsetWidth || 120;
    let lx = dir < 0 ? fx - 8 - lw : fx + 8;
    lx = Math.max(6, Math.min(w - lw - 6, lx));
    c.el.style.transform = `translate(${lx}px, ${ey - 8}px)`;
  }
}

/* =========================================================
   per-frame scene update
   ========================================================= */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V(), _v2 = V(), _s = V();
const camPos = V(), camTgt = V(), _t1 = V(), _t2 = V();

let capsidU = 0, prevT = 0, invertAt = -99;
function update(t, time, dt) {
  /* ---- camera ---- */
  const i0 = Math.min(Math.floor(t), LAST - 1);
  const f = t - i0;
  const fe = lerp(f, f * f * (3 - 2 * f), 0.7);
  camCurve.getPoint((i0 + fe) / LAST, camPos);
  camTgt.lerpVectors(KEYS[i0].t, KEYS[i0 + 1].t, fe);
  const intro = 1 - ss(0, 0.8, t);
  camPos.x += Math.sin(time * 0.13) * 2.5 * intro;
  camPos.y += Math.sin(time * 0.21) * 1.2 * intro;

  mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2.5);
  mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2.5);
  const dist = camPos.distanceTo(camTgt);
  const par = clamp(dist * 0.06, 0.12, 1.4);
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
  _t1.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _t2.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.position.addScaledVector(_t1, mouse.sx * par).addScaledVector(_t2, -mouse.sy * par * 0.6);
  camera.lookAt(camTgt);

  /* ---- T-cell ---- */
  cell.rotation.y = Math.sin(time * 0.08) * 0.35 * (1 - ss(1.1, 2.0, t)) + Math.sin(time * 0.05) * 0.2 * ss(9.6, 10, t);
  const see = 1 - 0.82 * ss(5.2, 5.9, t) * (1 - ss(7.6, 8.3, t));
  cellMat.uniforms.uOpacity.value = see;
  cellMat.uniforms.uSee.value = see;
  rbcMat.uniforms.uIntensity.value = lerp(0.45, 1.35, see);
  recTips.material.uniforms.uIntensity.value = 0.75 * lerp(0.3, 1, see);
  recStalks.material.uniforms.uIntensity.value = 0.6 * lerp(0.3, 1, see);
  const infected = ss(6.4, 7.6, t) * (1 - ss(9.1, 9.9, t));
  cellMat.uniforms.uRim.value.copy(C.cyan).lerp(C.violet, infected * 0.75);
  const dockGlow = ss(2.75, 3.1, t) * (1 - ss(6.0, 6.8, t));
  cellMat.uniforms.uDockGlow.value = dockGlow;
  cellMat.uniforms.uDockColor.value.copy(C.white).lerp(C.mag, ss(3.6, 4.2, t));

  // highlight the docking CD4 receptor
  const hl = 1 + (1.3 + Math.sin(time * 5) * 0.4) * ss(1.4, 2.0, t) * (1 - ss(5.2, 5.6, t));
  recTips.setColorAt(0, _v.set(hl, hl, hl));
  recTips.instanceColor.needsUpdate = true;

  // CCR5 rises out of the membrane
  const cc = ss(3.35, 4.0, t);
  ccr5.visible = cc > 0.001;
  ccr5.position.copy(d2).multiplyScalar(R - 0.35 + cc * 0.3);
  ccr5.scale.setScalar(Math.max(cc, 0.001));

  // nucleus
  const nuc = ss(5.3, 5.9, t) * (1 - ss(7.8, 8.4, t));
  const nucFlash = pulse(t, 7.35, 0.22);
  nucleusMat.uniforms.uOpacity.value = nuc;
  nucleusMat.uniforms.uIntensity.value = 0.7 + nucFlash * 1.4;
  nucleus.visible = chromatin.visible = nuc > 0.001;
  chromMat.uniforms.uOpacity.value = nuc * 0.9;
  if (nuc > 0.001) {
    const c = chromGeo.attributes.color.array;
    const integ = ss(7.0, 7.55, t);
    for (let i = 0; i < CHROM; i++) {
      const s = chromBase[i];
      const inGold = s > 0.12 && s < 0.12 + 0.05 * integ;
      const cc2 = inGold ? C.gold : C.violet;
      const k = inGold ? 1.6 : 0.55;
      c[i * 3] = cc2.r * k; c[i * 3 + 1] = cc2.g * k; c[i * 3 + 2] = cc2.b * k;
    }
    chromGeo.attributes.color.needsUpdate = true;
    chromatin.rotation.y = time * 0.05;
  }

  /* ---- virion ---- */
  const vis = ss(0.9, 1.4, t);
  virus.visible = vis > 0.001 && t < 5.9;
  const pA = ss(1.15, 2.05, t), pB = ss(2.55, 3.1, t), pC = ss(4.45, 5.3, t);
  _v.lerpVectors(FAR, HOVER, pA).lerp(DOCK, pB).lerp(FUSED, pC);
  const wob = (1 - pB) * vis;
  _v.x += Math.sin(time * 0.9) * 0.25 * wob;
  _v.y += Math.cos(time * 0.7) * 0.25 * wob;
  virus.position.copy(_v);
  const tumble = 1 - ss(1.6, 2.7, t);
  _q2.setFromAxisAngle(tumbleAxis, tumble * (time * 0.5 + 2.4));
  virus.quaternion.copy(qDock).multiply(_q2);
  _q.setFromAxisAngle(V(0, 0, 1), time * 0.15 * tumble);
  virus.quaternion.multiply(_q);

  const envFade = 1 - ss(4.7, 5.45, t);
  envMat.uniforms.uOpacity.value = envFade * vis;
  latticeMat.opacity = 0.18 * envFade * vis;
  envelope.scale.set(1 + pC * 0.45, 1 + pC * 0.45, 1 - pC * 0.55);
  spikeMat.uniforms.uOpacity.value = (1 - ss(4.6, 5.15, t)) * vis;
  spikeGroup.scale.setScalar(1 - ss(4.6, 5.15, t) * 0.25);
  // gp120 bound → conformational change glows white
  const bound = ss(2.9, 3.2, t);
  const sc = 1 + bound * (1.1 + Math.sin(time * 6) * 0.3);
  for (let k = 0; k < 3; k++) spikeHead.setColorAt(k, _s.set(sc, sc, sc));
  spikeStalk.setColorAt(0, _s.set(sc, sc, sc));
  spikeHead.instanceColor.needsUpdate = spikeStalk.instanceColor.needsUpdate = true;

  /* ---- capsid ---- */
  const u = ss(5.45, 6.95, t);
  const capVis = ss(1.0, 1.6, t) * (1 - ss(7.0, 7.4, t));
  capsid.visible = capVis > 0.001;
  if (t < 5.45) {
    capsid.position.copy(virus.position);
    capsid.quaternion.copy(virus.quaternion);
  } else {
    capsidPath(u, capsid.position);
    capsidPath(Math.min(u + 0.02, 1), _v2);
    _q.setFromUnitVectors(V(0, 0, 1), _v2.sub(capsid.position).normalize().lengthSq() > 0 ? _v2 : d.clone().negate());
    capsid.quaternion.slerp(_q, 0.15);
  }
  capsid.scale.setScalar(Math.max(capVis, 0.001) * (1 + pulse(t, 5.2, 0.2) * 0.15));
  capsid.rotateZ(dt * 0.4);

  /* ---- gp41 harpoons ---- */
  const hp = ss(4.1, 4.5, t) * (1 - ss(5.0, 5.4, t));
  harpoonMat.opacity = hp;
  harpoons.visible = hp > 0.001;
  if (harpoons.visible) {
    const p = harpoonGeo.attributes.position.array;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + time * 0.2;
      _t1.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(upv, Math.sin(a));
      _v.copy(virus.position).addScaledVector(d, -VR * 0.8).addScaledVector(_t1, VR * 0.55);
      const reach = ss(4.1, 4.4, t);
      _v2.copy(D).addScaledVector(d, 0.05).addScaledVector(_t1, 0.6);
      _v2.lerpVectors(_v, _v2, reach);
      p.set([_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z], k * 6);
    }
    harpoonGeo.attributes.position.needsUpdate = true;
  }

  /* ---- contact flash ---- */
  const f1 = pulse(t, 3.0, 0.28), f2 = pulse(t, 3.95, 0.28), f3 = pulse(t, 4.72, 0.2);
  const fl = Math.max(f1, f2, f3);
  flashMat.opacity = clamp(fl) * (0.4 + Math.sin(time * 12) * 0.08);
  flashMat.color.copy(C.white).lerp(C.mag, clamp(f2 + f3 - f1));
  flash.position.copy(D).addScaledVector(d, 0.55);
  flash.scale.setScalar(1.3 + f3 * 2.2);
  flash.visible = fl > 0.01;

  /* ---- fusion burst ---- */
  const be = ss(4.95, 6.2, t);
  burst.visible = be > 0 && be < 1;
  if (burst.visible) {
    const p = burstGeo.attributes.position.array, c = burstGeo.attributes.color.array;
    const fade = (1 - be) * (1 - be);
    for (let i = 0; i < BURST; i++) {
      const bd = burstDirs[i];
      _v.copy(D).addScaledVector(bd.v, Math.sqrt(be) * bd.s);
      p[i * 3] = _v.x; p[i * 3 + 1] = _v.y; p[i * 3 + 2] = _v.z;
      c[i * 3] = bd.c.r * fade; c[i * 3 + 1] = bd.c.g * fade; c[i * 3 + 2] = bd.c.b * fade;
    }
    burstGeo.attributes.position.needsUpdate = burstGeo.attributes.color.needsUpdate = true;
  }

  /* ---- reverse transcription trail ---- */
  const trVis = ss(5.55, 5.9, t) * (1 - ss(7.3, 7.9, t));
  trail.visible = trVis > 0.001;
  if (trail.visible) {
    const p = trailGeo.attributes.position.array, c = trailGeo.attributes.color.array;
    const half = TRAIL / 2;
    for (let i = 0; i < TRAIL; i++) {
      const strand = i < half ? 0 : 1;
      const s = ((i % half) / half) * u;
      capsidPath(s, _v);
      capsidPath(Math.min(s + 0.01, 1), _v2);
      _t2.subVectors(_v2, _v).normalize();
      _t1.crossVectors(_t2, UP).normalize();
      _s.crossVectors(_t2, _t1);
      const ang = s * 60 + strand * Math.PI - time * 1.4;
      const behind = u - s;                         // how long ago this piece was copied
      const conv = ss(0.0, 0.18, behind);          // 0 = RNA, 1 = DNA
      _v.addScaledVector(_t1, Math.cos(ang) * 0.13).addScaledVector(_s, Math.sin(ang) * 0.13);
      p[i * 3] = _v.x; p[i * 3 + 1] = _v.y; p[i * 3 + 2] = _v.z;
      const k = trVis * (strand === 0 ? 1 : conv) * (s < u ? 1 : 0);
      _v2.set(C.mag.r, C.mag.g, C.mag.b).lerp(_s.set(C.gold.r, C.gold.g, C.gold.b), conv);
      c[i * 3] = _v2.x * k; c[i * 3 + 1] = _v2.y * k; c[i * 3 + 2] = _v2.z * k;
    }
    trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;
  }

  /* ---- budding virions ---- */
  buds.visible = t > 7.4;
  if (buds.visible) {
    for (let i = 0; i < BUDS; i++) {
      const b = budData[i];
      const e = clamp((t - b.birth) / 0.95);
      const kill = 1 - ss(b.kill, b.kill + 0.35, t);
      const s = ss(0, 0.18, e) * kill * b.s;
      const r = R + 0.25 + Math.pow(e, 1.4) * b.dist;
      _v.copy(b.dir).multiplyScalar(r);
      _v.x += Math.sin(time * 0.6 + b.wob) * 0.3 * e;
      _v.y += Math.cos(time * 0.5 + b.wob) * 0.3 * e;
      b.pos.copy(_v);
      _m.compose(_v, _q.identity(), _s.set(s, s, s).addScalar(0.0001));
      buds.setMatrixAt(i, _m);
    }
    buds.instanceMatrix.needsUpdate = true;
  }

  /* ---- antiretroviral drugs ---- */
  const dv = ss(8.6, 9.2, t) * (1 - ss(10.2, 10.8, t) * 0.6);
  drugMat.uniforms.uOpacity.value = dv;
  drugs.visible = dv > 0.001;
  if (drugs.visible) {
    const p = drugGeo.attributes.position.array;
    const squeeze = lerp(1, 0.55, ss(8.9, 9.6, t)) * lerp(1, 1.6, ss(9.8, 10, t));
    for (let i = 0; i < DRUGS; i++) {
      const r = drugData[i * 4] * squeeze;
      const th = drugData[i * 4 + 1] + time * drugData[i * 4 + 3];
      const ph = drugData[i * 4 + 2];
      p[i * 3] = r * Math.sin(ph) * Math.cos(th);
      p[i * 3 + 1] = r * Math.cos(ph);
      p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    drugGeo.attributes.position.needsUpdate = true;
  }

  /* ---- erythrocyte stream, flowing around the cell ---- */
  const excl = lerp(6.8, 10.5, ss(1.2, 2.2, t) * (1 - ss(8.0, 9.0, t)));
  const M = excl + 3.5;
  for (let i = 0; i < RBC; i++) {
    const b = rbcData[i];
    b.p.x += b.speed * dt;
    if (b.p.x > 70) { b.p.x -= 140; b.p.y = rr(-26, 26); b.p.z = rr(-55, 24); }
    _v.copy(b.p);
    _v.y += Math.sin(time * 0.4 + b.phase) * 0.6;
    const len = _v.length();
    let s = b.s;
    if (len < M) {
      _v.multiplyScalar((excl + (len / M) * 3.5) / Math.max(len, 0.001));
      s *= ss(0.15, 0.6, len / M) * 0.7 + 0.3;
    }
    _q.setFromAxisAngle(b.axis, time * b.spin + b.phase);
    _m.compose(_v, _q, _s.set(s, s, s));
    b.pos = (b.pos || V()).copy(_v);
    rbc.setMatrixAt(i, _m);
  }
  rbc.instanceMatrix.needsUpdate = true;

  /* ---- post ---- */
  bloom.strength = 0.35 + f3 * 0.4 + nucFlash * 0.3;
  // negative flash: a short strobe when the scroll crosses fusion / integration, not a held state
  if ((prevT < 4.95 && t >= 4.95) || (prevT < 7.3 && t >= 7.3)) invertAt = performance.now() / 1000;
  prevT = t;
  styleU.uInvert.value = reduceMotion ? 0 : Math.exp(-(performance.now() / 1000 - invertAt) * 5) * 0.9;
  capsidU = u;
}

/* =========================================================
   loop
   ========================================================= */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = w < h ? 55 : 42;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  styleU.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  styleU.uCell.value = (w < 760 ? 7 : 9) * renderer.getPixelRatio();
  layoutTitles();
  readScroll();
}
window.addEventListener('resize', resize);
resize();


/* =========================================================
   appendices: reveal, ASCII plots
   ========================================================= */
const revealIO = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('in'); if (e.target.onReveal) e.target.onReveal(); }
}), { threshold: 0.12 });
document.querySelectorAll('.appx-intro, .appx, .colophon').forEach((el) => revealIO.observe(el));

// ---- natural course of infection: CD4 and viral load over 12 years ----
const courseEl = document.getElementById('course');
let courseMode = 0, courseAnim = 0, courseLast = -1;
const cd4U = (t) => {
  if (t < 0.15) return 1000 - 500 * (t / 0.15);
  if (t < 0.5) return 500 + 250 * ((t - 0.15) / 0.35);
  return Math.max(15, 750 - 60 * (t - 0.5) - (t > 8 ? 45 * Math.pow(t - 8, 1.6) : 0));
};
const vlU = (t) => {
  if (t < 0.12) return 2 + 4.3 * (t / 0.12);
  if (t < 0.5) return 6.3 - 1.8 * ((t - 0.12) / 0.38);
  return Math.min(5.9, 4.5 + 0.08 * (t - 0.5) + (t > 8 ? 0.25 * (t - 8) : 0));
};
const ART0 = 2;
const cd4 = (t, m) => (m && t > ART0 ? cd4U(ART0) + (720 - cd4U(ART0)) * (1 - Math.exp(-(t - ART0) / 2.4)) : cd4U(t));
const vlc = (t, m) => (m && t > ART0 ? Math.max(1.2, vlU(ART0) - 6 * (t - ART0)) : vlU(t));
function renderCourse(p) {
  const W = isMobile ? 40 : 62, H = 13, YRS = 12;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => [' ', '']));
  const rowOf = (v) => Math.round((1 - v) * (H - 1));
  const aids = rowOf(200 / 1200);
  for (let c = 0; c < W; c += 2) grid[aids][c] = ['-', 't'];
  const upto = Math.floor(p * W);
  for (let c = 0; c < upto; c++) {
    const t = (c / (W - 1)) * YRS;
    const rv = rowOf(vlc(t, courseMode) / 6);
    if (rv >= 0 && rv < H) grid[rv][c] = ['*', 'm'];
    const rc = rowOf(cd4(t, courseMode) / 1200);
    if (rc >= 0 && rc < H) grid[rc][c] = ['#', 'd'];
  }
  if (courseMode) {
    const c = Math.round((ART0 / YRS) * (W - 1));
    for (let r = 0; r < H; r++) if (grid[r][c][0] === ' ') grid[r][c] = ['|', 'm'];
  }
  const lab = (r) => {
    const v = Math.round((1 - r / (H - 1)) * 1200);
    return r % 2 === 0 ? String(v).padStart(4) + ' +' : '     |';
  };
  const labR = (r) => (r % 2 === 0 ? '+ 10^' + Math.round((1 - r / (H - 1)) * 6) : '|');
  let out = '';
  const phases = isMobile ? ' остр.  бессимптомно             СПИД' : ' острая   бессимптомная стадия                         СПИД';
  out += '      ' + (courseMode ? ' v АРТ' + ' '.repeat(Math.max(0, Math.round((ART0 / YRS) * W) - 6)) + 'нагрузка < 50 · CD4 восстанавливаются' : phases) + '\n';
  for (let r = 0; r < H; r++) {
    let line = '';
    for (const [ch, cls] of grid[r]) line += cls ? `<span class="${cls}">${ch}</span>` : ch;
    out += lab(r) + line + labR(r) + '\n';
  }
  let axis = '     +', ticks = '      ';
  const tickCols = new Set();
  for (let yr = 0; yr <= YRS; yr += 2) tickCols.add(Math.round((yr / YRS) * (W - 1)));
  for (let c = 0; c < W; c++) axis += tickCols.has(c) ? '+' : '-';
  for (let yr = 0; yr <= YRS; yr += 2) {
    const c = Math.round((yr / YRS) * (W - 1));
    ticks = ticks.padEnd(6 + c) + yr;
  }
  out += axis + (tickCols.has(W - 1) ? '' : '+') + '\n' + ticks + '  лет';
  courseEl.innerHTML = out;
}
courseEl.closest('.appx').onReveal = () => { if (courseAnim === 0) courseAnim = 0.0001; };
document.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
  courseMode = +b.dataset.course;
  document.querySelectorAll('[data-course]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  courseAnim = 0.0001; glitch = Math.max(glitch, 0.5);
}));
renderCourse(0);

// ---- global numbers ----
const barsEl = document.getElementById('bars');
const BARS = [
  ['живут с ВИЧ', 39.9, 'млн', 'd'],
  ['получают АРТ', 30.7, 'млн', 'd'],
  ['новых заражений / год', 1.3, 'млн', 'm'],
  ['смертей от СПИДа / год', 0.63, 'млн', 'm'],
];
let barsAnim = 0, barsLast = -1;
function renderBars(p) {
  const W = isMobile ? 18 : 40;
  const pad = isMobile ? 16 : 24;
  let out = '';
  for (const [name, v, u, cls] of BARS) {
    const full = (v / 40) * W * p;
    const n = Math.floor(full);
    const half = full - n > 0.5 ? ':' : (v > 0 && n === 0 && p > 0.2 ? '|' : '');
    const val = (v * Math.min(1, p * 1.2)).toFixed(v < 1 ? 2 : 1).replace('.', ',');
    out += `${name.padEnd(pad)}<span class="${cls}">${(cls === 'm' ? '=' : '#').repeat(n)}${half}</span> ${val} ${u}\n`;
  }
  out += `${''.padEnd(pad)}${'+' + '-'.repeat(W - 1)}\n${''.padEnd(pad)}0${' '.repeat(W - 5)}40 млн`;
  barsEl.innerHTML = out;
}
barsEl.closest('.appx').onReveal = () => { if (barsAnim === 0) barsAnim = 0.0001; };
renderBars(0);

function updateAppendix(dt) {
  if (courseAnim > 0 && courseAnim < 1) {
    courseAnim = Math.min(1, courseAnim + dt / (reduceMotion ? 0.01 : 1.8));
    const q = Math.floor(courseAnim * 80);
    if (q !== courseLast) { courseLast = q; renderCourse(courseAnim); }
  }
  if (barsAnim > 0 && barsAnim < 1) {
    barsAnim = Math.min(1, barsAnim + dt / (reduceMotion ? 0.01 : 1.4));
    const q = Math.floor(barsAnim * 60);
    if (q !== barsLast) { barsLast = q; renderBars(1 - Math.pow(1 - barsAnim, 3)); }
  }
}


/* =========================================================
   infographics: ASCII numerals, world map, cascade, trend, tiles
   ========================================================= */
// generic text → ASCII-art (used for the plate numerals)
function asciiArt(text, cols, font = (px) => `900 ${px}px "Playfair Display", "Times New Roman", serif`) {
  const cv = document.createElement('canvas');
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.font = font(100);
  const tw = x.measureText(text).width || 100;
  const ADV = 0.6, ASPECT = 1 / ADV, SS = 5;
  const F = (100 * cols) / tw;
  const rows = Math.max(3, Math.ceil((F * 0.86) / ASPECT));
  cv.width = cols * SS; cv.height = rows * SS;
  x.scale(SS, SS / ASPECT);
  x.fillStyle = '#fff'; x.font = font(F); x.textBaseline = 'alphabetic';
  x.fillText(text, 0, F * 0.78);
  const d = x.getImageData(0, 0, cv.width, cv.height).data;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let yy = 0; yy < SS; yy++) for (let xx = 0; xx < SS; xx++) sum += d[((r * SS + yy) * cv.width + c * SS + xx) * 4 + 3];
      const a = sum / (SS * SS * 255);
      out += a > 0.6 ? '#' : a > 0.32 ? '+' : a > 0.1 ? '.' : ' ';
    }
    out += '\n';
  }
  return out.replace(/\s+$/g, '');
}
function drawNumerals() {
  document.querySelectorAll('.card .wm').forEach((el) => {
    const t = el.dataset.text || '';
    el.textContent = asciiArt(t, Math.min(56, 12 + t.length * 11));
  });
}

// ---------- world map ----------
const REGIONS = {
  E: { n: 'Восточная и Южная Африка', p: 20.8, i: 450, lvl: 4, note: 'Больше половины всех людей с ВИЧ в мире. Здесь же сильнее всего снизилось число новых заражений с 2010 года.' },
  W: { n: 'Западная и Центральная Африка', p: 5.1, i: 180, lvl: 3, note: 'Отстаёт по охвату лечением, особенно среди детей: многие не знают о диагнозе.' },
  C: { n: 'Карибский бассейн', p: 0.34, i: 16, lvl: 3, note: 'Вторая по распространённости зона после Африки к югу от Сахары.' },
  R: { n: 'Восточная Европа и Центральная Азия', p: 2.1, i: 140, lvl: 3, note: 'Один из немногих регионов, где эпидемия растёт. Основная часть новых случаев — в России.' },
  L: { n: 'Латинская Америка', p: 2.5, i: 120, lvl: 2, note: 'Число новых заражений растёт.' },
  N: { n: 'Западная и Центральная Европа, Северная Америка', p: 2.3, i: 58, lvl: 1, note: 'Высокий охват АРТ: у большинства людей с ВИЧ вирус подавлен.' },
  A: { n: 'Азия и Тихоокеанский регион', p: 6.7, i: 300, lvl: 1, note: 'Доля в населении невелика, но в абсолютных числах это второй регион мира.' },
  M: { n: 'Ближний Восток и Северная Африка', p: 0.19, i: 19, lvl: 0, note: 'Самая низкая распространённость, но заражения растут, а охват лечением один из самых низких.' },
};
const LVL = ['.', ':', '+', '#', '@'];
const LVL_TXT = ['< 0,1%', '0,1–0,5%', '0,5–1%', '1–5%', '> 5%'];
const mapEl = document.getElementById('worldmap');
const panelEl = document.getElementById('mappanel');
const regionsEl = document.getElementById('regions');
let spansByR = {}, mapActive = null, mapPausedUntil = 0, mapCycleT = 0, mapCycleI = 0, mapVisible = false;
const fmtNum = (v, dec = 1) => v.toFixed(dec).replace('.', ',');
function renderMap() {
  const grid = mapEl.clientWidth < 760 ? WORLD.small : WORLD.big;
  const cols = grid[0].length, rows = grid.length;
  mapEl.style.fontSize = `${Math.max(6.5, Math.min(11, (mapEl.clientWidth - 26) / (cols * 0.6)))}px`;
  let html = '';
  for (let r = 0; r < rows; r++) {
    const lat = 84 - ((r + 0.5) / rows) * 142;
    const latLine = [60, 30, 0, -30].some((L) => Math.abs(lat - L) < 71 / rows);
    let line = '', run = '', key = null;
    const flush = () => {
      if (!run) return;
      if (key === 'o') line += `<span class="o">${run}</span>`;
      else line += `<span data-r="${key.toUpperCase()}"${key === key.toLowerCase() ? ' class="k"' : ''}>${run}</span>`;
      run = '';
    };
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c] || ' ';
      let k, g;
      if (ch === ' ') {
        const lon = -180 + ((c + 0.5) / cols) * 360;
        const lonLine = Math.abs(lon - Math.round(lon / 30) * 30) < 180 / cols;
        k = 'o'; g = (lonLine && r % 2 === 0) || (latLine && c % 3 === 0) ? '·' : ' ';
      } else {
        k = ch; g = LVL[REGIONS[ch.toUpperCase()].lvl];
      }
      if (k !== key) { flush(); key = k; }
      run += g;
    }
    flush();
    html += `<span class="row" style="--r:${r}">${line}</span>`;
  }
  mapEl.innerHTML = html;
  spansByR = {};
  mapEl.querySelectorAll('[data-r]').forEach((sp) => (spansByR[sp.dataset.r] = spansByR[sp.dataset.r] || []).push(sp));
  setRegion(mapActive, true);
}
function setRegion(k, force) {
  if (k === mapActive && !force) return;
  if (mapActive && spansByR[mapActive]) spansByR[mapActive].forEach((s) => s.classList.remove('on'));
  mapActive = k;
  mapEl.classList.toggle('hl', !!k);
  if (k && spansByR[k]) spansByR[k].forEach((s) => s.classList.add('on'));
  [...regionsEl.children].forEach((b) => { const on = b.dataset.r === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  if (!k) {
    panelEl.innerHTML = `<h3>весь мир · 2023</h3><dl><dt>живут с ВИЧ</dt><dd>39,9 млн</dd><dt>новых заражений за год</dt><dd>1,3 млн</dd><dt>смертей от СПИДа</dt><dd>630 тыс.</dd></dl><p>Наведи курсор на регион.</p>`;
    return;
  }
  const R0 = REGIONS[k];
  const share = R0.p / 39.9;
  const n = Math.max(1, Math.round(share * 20));
  panelEl.innerHTML = `<h3>${R0.n}</h3><dl><dt>живут с ВИЧ</dt><dd>${R0.p < 1 ? Math.round(R0.p * 1000) + ' тыс.' : fmtNum(R0.p) + ' млн'}</dd><dt>новых заражений в 2023</dt><dd>≈ ${R0.i} тыс.</dd><dt>взрослые 15–49 с ВИЧ</dt><dd>${LVL_TXT[R0.lvl]} &nbsp;<code>${LVL[R0.lvl]}</code></dd></dl><p><code>[${'#'.repeat(n)}${'.'.repeat(20 - n)}]</code> ${Math.round(share * 100)}% мира</p><p>${R0.note}</p>`;
}
Object.entries(REGIONS).forEach(([k, r]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.r = k; b.textContent = `${LVL[r.lvl]} ${r.n}`; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => { mapPausedUntil = performance.now() + 12000; setRegion(mapActive === k ? null : k); });
  regionsEl.appendChild(b);
});
mapEl.addEventListener('mousemove', (e) => {
  const sp = e.target.closest && e.target.closest('[data-r]');
  mapPausedUntil = performance.now() + 6000;
  if (sp) setRegion(sp.dataset.r);
});
mapEl.addEventListener('mouseleave', () => { mapPausedUntil = performance.now() + 1500; });
new IntersectionObserver((es) => es.forEach((e) => { mapVisible = e.isIntersecting; })).observe(mapEl);
const CYCLE = ['E', 'W', 'C', 'R', 'L', 'N', 'A', 'M', null];
function updateMap(time) {
  if (!mapVisible || reduceMotion || performance.now() < mapPausedUntil || time - mapCycleT < 3.2) return;
  mapCycleT = time;
  setRegion(CYCLE[mapCycleI++ % CYCLE.length]);
}
renderMap();
window.addEventListener('resize', () => { renderMap(); drawNumerals(); });

// ---------- cascade 95-95-95 ----------
const cascadeEl = document.getElementById('cascade');
const CAS = [[86, 77, 72], [95, 90, 86]];
const CAS_T = ['знают свой ВИЧ-статус', 'получают АРТ', 'вирусная нагрузка подавлена'];
let casMode = 0, casAnim = 0, casLast = -1;
function renderCascade(p) {
  cascadeEl.innerHTML = CAS[casMode].map((v, k) => {
    const filled = Math.round(v * Math.min(1, p * (1 + k * 0.15)));
    let g = '';
    for (let i = 0; i < 100; i++) { g += i < filled ? '<span class="f">#</span>' : '.'; if (i % 10 === 9) g += '\n'; }
    return `<figure><pre aria-hidden="true">${g}</pre><figcaption><b>${filled}</b>из 100 — ${CAS_T[k]}</figcaption></figure>`;
  }).join('');
}
document.querySelectorAll('[data-cascade]').forEach((b) => b.addEventListener('click', () => {
  casMode = +b.dataset.cascade;
  document.querySelectorAll('[data-cascade]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  casAnim = 0.0001; glitch = Math.max(glitch, 0.4);
}));
cascadeEl.closest('.appx').onReveal = () => { if (casAnim === 0) casAnim = 0.0001; };
renderCascade(0);

// ---------- trend 1995–2023: anchors are UNAIDS estimates ----------
const trendEl = document.getElementById('trend');
const INF = [[1995, 3.3], [2010, 2.1], [2023, 1.3]];
const DEA = [[2004, 2.1], [2010, 1.3], [2023, 0.63]];
let trendAnim = 0, trendLast = -1;
function renderTrend(p) {
  const Y0 = 1995, Y1 = 2023, per = isMobile ? 1 : 2, W = (Y1 - Y0) * per + 1, H = 15, MAX = 3.5;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => [' ', '']));
  const rowOf = (v) => Math.round((1 - v / MAX) * (H - 1));
  const colOf = (y) => Math.round((y - Y0) * per);
  const upto = Math.floor(p * W);
  const put = (c, r, ch, cls) => { if (c >= 0 && c < W && r >= 0 && r < H && c <= upto) grid[r][c] = [ch, cls]; };
  const drawSeries = (pts, mark) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [y0, v0] = pts[k], [y1, v1] = pts[k + 1];
      for (let c = colOf(y0); c <= colOf(y1); c++) {
        const y = Y0 + c / per, v = v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
        if (grid[rowOf(v)][c][0] === ' ') put(c, rowOf(v), '.', 'd');
      }
    }
    pts.forEach(([y, v]) => {
      put(colOf(y), rowOf(v), mark, 'a');
      const lab = `${fmtNum(v, v < 1 ? 2 : 1)}`;
      [...lab].forEach((ch, i) => put(colOf(y) + 2 + i, rowOf(v), ch, 'm'));
    });
  };
  drawSeries(INF, 'O');
  drawSeries(DEA, 'X');
  let out = '';
  for (let r = 0; r < H; r++) {
    const v = (1 - r / (H - 1)) * MAX;
    out += (r % 2 === 0 ? fmtNum(v).padStart(4) + ' +' : '     |');
    for (const [ch, cls] of grid[r]) out += cls ? `<span class="${cls}">${ch}</span>` : ch;
    out += '\n';
  }
  let axis = '     +', ticks = '      ';
  const tickYears = [1995, 2000, 2005, 2010, 2015, 2020, 2023];
  const tc = new Set(tickYears.map(colOf));
  for (let c = 0; c < W; c++) axis += tc.has(c) ? '+' : '-';
  tickYears.forEach((y) => { const c = colOf(y); if (!isMobile || y % 10 === 5 || y === 2023) ticks = ticks.padEnd(6 + c) + y; });
  trendEl.innerHTML = out + axis + '\n' + ticks + '  млн/год';
}
trendEl.closest('.appx').onReveal = () => { if (trendAnim === 0) trendAnim = 0.0001; };
renderTrend(0);

// ---------- count-up tiles ----------
const tiles = [...document.querySelectorAll('.tiles b[data-count]')];
let tilesAnim = 0;
function renderTiles(p) {
  const e = 1 - Math.pow(1 - p, 3);
  tiles.forEach((b) => {
    const v = +b.dataset.count * e, dec = +(b.dataset.dec || 0);
    b.textContent = (dec ? fmtNum(v, dec) : Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')) + (b.dataset.suffix || '');
  });
}
const trendReveal = trendEl.closest('.appx').onReveal;
trendEl.closest('.appx').onReveal = () => { trendReveal(); if (tilesAnim === 0) tilesAnim = 0.0001; };

function updateInfographics(time, dt) {
  updateMap(time);
  const step = (a, dur) => Math.min(1, a + dt / (reduceMotion ? 0.01 : dur));
  if (casAnim > 0 && casAnim < 1) { casAnim = step(casAnim, 1.3); const q = Math.floor(casAnim * 60); if (q !== casLast) { casLast = q; renderCascade(casAnim); } }
  if (trendAnim > 0 && trendAnim < 1) { trendAnim = step(trendAnim, 1.6); const q = Math.floor(trendAnim * 70); if (q !== trendLast) { trendLast = q; renderTrend(trendAnim); } }
  if (tilesAnim > 0 && tilesAnim < 1) { tilesAnim = step(tilesAnim, 1.6); renderTiles(tilesAnim); }
}

/* ---------- plate furniture: scanner line, roman watermark, word reveal ---------- */
chapters.forEach((ch) => {
  const card = ch.querySelector('.card');
  if (!card) return;
  const scan = document.createElement('i'); scan.className = 'scan'; scan.setAttribute('aria-hidden', 'true');
  const wm = document.createElement('pre'); wm.className = 'wm'; wm.dataset.text = ch.dataset.roman; wm.setAttribute('aria-hidden', 'true');
  card.prepend(scan, wm);
});
function splitWords(el) {
  let d = 0;
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span');
          w.className = 'w'; w.style.setProperty('--d', d++); w.textContent = part;
          frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
}
document.querySelectorAll('.card h2, .appx h2, .appx-h').forEach(splitWords);
drawNumerals();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawNumerals);
buildZine({ chapters, appendices: [...document.querySelectorAll('.appx, .colophon')], isMobile });
['s1', 's2', 's3'].forEach((id, k) => { const el = document.getElementById(id); if (el) scrawl(el, 40 + k * 11); });
const dustEl = xeroxDust();
let dustT = 0;
function updateDust(time) {
  if (reduceMotion || time - dustT < 0.11) return;
  dustT = time;
  dustEl.style.backgroundPosition = `${(Math.random() * 900) | 0}px ${(Math.random() * 900) | 0}px`;
}
document.querySelectorAll('.timeline li, .shields li').forEach((li, i, all) => li.style.setProperty('--i', [...li.parentElement.children].indexOf(li)));
document.querySelectorAll('.gloss > *').forEach((el) => el.style.setProperty('--i', Math.floor([...el.parentElement.children].indexOf(el) / 2)));

/* decoding effect for mono captions: letters settle out of nucleotide noise */
const SCRAMBLE = 'ACGU#%*+=:';
function decode(el, dur = 900) {
  if (reduceMotion) return;
  const nodes = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) nodes.push(tw.currentNode);
  nodes.forEach((n) => { if (n.__o === undefined) n.__o = n.nodeValue; });
  const at = nodes.map((n) => [...n.__o].map(() => Math.random() * 0.85));
  const t0 = performance.now();
  if (el.__raf) cancelAnimationFrame(el.__raf);
  const step = (now) => {
    const p = (now - t0) / dur;
    nodes.forEach((n, k) => {
      let s2 = '';
      [...n.__o].forEach((c, i) => { s2 += /\s/.test(c) || p > at[k][i] ? c : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]; });
      n.nodeValue = s2;
    });
    if (p < 1) el.__raf = requestAnimationFrame(step);
    else nodes.forEach((n) => { n.nodeValue = n.__o; });
  };
  el.__raf = requestAnimationFrame(step);
}
const decodeTargets = chapters.map((ch) => [...ch.querySelectorAll('.num, .kicker, .fact span')]);
const wasIn = chapters.map(() => false);
function updateDecode() {
  chapters.forEach((ch, i) => {
    const on = ch.classList.contains('in');
    if (on && !wasIn[i]) decodeTargets[i].forEach((el, k) => setTimeout(() => decode(el), 250 + k * 120));
    wasIn[i] = on;
  });
}
document.querySelectorAll('.appx, .appx-intro, .colophon').forEach((el) => {
  const prev = el.onReveal;
  el.onReveal = () => { if (prev) prev(); if (!el.__decoded) { el.__decoded = true; el.querySelectorAll('.num, .kicker').forEach((n) => decode(n)); } };
});

/* ---------- ASCII virion in the archive intro ---------- */
const appxVirionEl = document.getElementById('appxVirion');
let stopAppxVirion = null;
new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting && !stopAppxVirion && window.asciiVirion) stopAppxVirion = window.asciiVirion(appxVirionEl, isMobile ? 40 : 56, isMobile ? 18 : 24);
  else if (!e.isIntersecting && stopAppxVirion) { stopAppxVirion(); stopAppxVirion = null; }
})).observe(appxVirionEl);

/* ---------- running genome ticker ---------- */
const tickerEl = document.getElementById('ticker');
const TICK_W = 56;
const tickSeq = Array.from({ length: TICK_W }, () => [BASES[(rand() * 4) | 0], false]);
let tickT = 0;
function updateTicker(time) {
  if (isMobile || time - tickT < 0.09) return;
  tickT = time;
  tickSeq.shift();
  tickSeq.push([BASES[(rand() * 4) | 0], rand() < 0.035]);
  tickerEl.innerHTML = "5'-" + tickSeq.map(([b, m]) => (m ? `<span class="m">${b}</span>` : b)).join('') + "-3'";
}

const clock = new THREE.Clock();
let time = 0, first = true;
function frame() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  time += dt * (reduceMotion ? 0.35 : 1);
  shared.uTime.value = time;
  tNow += (tTarget - tNow) * (1 - Math.exp(-Math.min(raw, 0.25) * (reduceMotion ? 8 : 3.2)));
  if (Math.abs(tTarget - tNow) < 1e-4) tNow = tTarget;

  update(tNow, time, dt);
  updateUI(tNow, time, dt);
  updateCallouts(tNow);
  updateDecode();
  updateTicker(time);
  updateDust(time);
  updateStyle(time, dt, Math.min(raw, 0.25));
  updateAppendix(raw < 0.5 ? raw : 0.05);
  updateInfographics(time, raw < 0.5 ? raw : 0.05);
  composer.render();

  if (first) {
    first = false;
    const wait = Math.max(0, 1500 - (performance.now() - (window.__t0 || 0)));
    setTimeout(() => {
      const lt = document.getElementById('loaderTxt');
      if (lt) lt.textContent = 'инкубация образца · 100%';
      document.body.classList.add('ready');
      glitch = 1;
      setTimeout(() => window.__stopLoader && window.__stopLoader(), 1400);
    }, wait);
  }
  requestAnimationFrame(frame);
}
readScroll();
tNow = tTarget;
frame();
