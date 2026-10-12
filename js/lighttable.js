// js/lighttable.js — the film light table (观片台) in the Imaging section.
//
// Ported from spektralab.app (SpektraLab Website/src/lighttable.js, as of 2026-10-12). The
// shaders, the layout, the physics and the events are that file's, unchanged. What differs:
//   · three.js and the image manifest are files beside this one, because nothing bundles this
//     site. tools/build_lighttable.mjs writes both and copies the strips' renditions.
//   · The captions and the spoken strings are Chinese, in the app's own zh-Hans terms.
//   · The stage sits in the text column instead of across the page, so each end of the box
//     keeps the desk margin of its top edge instead of lining up with a page column.
//   · A strip's description is read from the gallery in the same section.
//
// The table is measured in millimetres and seen straight down through an orthographic camera,
// so every strip keeps its true size relative to the others: an XPan is nearly two 135 frames,
// a 6×12 dwarfs a half frame. The desk, the aluminium frame and the backlit diffuser are one
// shader on one plane. Each strip is *multiplied* onto the panel — what a transparency does to
// the light behind it — so the perforations and clear highlights are the panel showing through.
// The loupe renders the same scene at 3× into a small target and draws it back through a lens.
//
// mount(root) resolves to { destroy } once the stage is up, or to null when WebGL 2 is not
// available; then nothing changes and the HTML gallery after the stage stays where it is.
// js/site.js calls it when the section is near.

import {
  ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, Mesh, MultiplyBlending, NormalBlending,
  OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Texture, WebGLRenderTarget, WebGLRenderer,
} from './vendor/three.lighttable.min.js';
import manifest from './lighttable.manifest.js';

// Left to right as they lie on the table. `film` is the film's width in mm and `across` the image
// axis it runs along: the render includes the rebate, so that dimension is the film itself.
// `px` is the source image's size, which gives the other dimension.
const STRIPS = [
  { id: 'strip-courtyard', caption: 'Kodak Portra 400 · 135', film: 35, across: 'height', px: [8636, 7971] },
  { id: 'strip-harbour', caption: 'Fujifilm Provia 100F · 6×9', film: 61.5, across: 'width', px: [4962, 7071] },
  { id: 'strip-badlands', caption: 'Kodak Portra 160 · 135 半格', film: 35, across: 'height', px: [3735, 6899] },
  { id: 'strip-stars', caption: 'Fujifilm Velvia 100 · 6×12', film: 61.5, across: 'height', px: [8433, 4451] },
  { id: 'strip-beach', caption: 'Kodak Portra 400 · 135', film: 35, across: 'height', px: [8513, 7858] },
  { id: 'strip-bark', caption: 'Kodak Portra 400 · 645', film: 61.5, across: 'height', px: [5968, 8105] },
  { id: 'strip-xpan', caption: 'Kodak Vision3 500T · XPan · 放映拷贝片 Vision 2383', film: 35, across: 'height', px: [8468, 4446] },
  { id: 'bw-acros', caption: 'Fujifilm Neopan 100 Acros II · 135 · 相纸 Ilford Multigrade IV RC', film: 35, across: 'width', px: [7971, 8630] },
  { id: 'strip-alcatraz', caption: 'Fujifilm X-Tra 400 · 6×8 · 日期后背与拍摄数据', film: 61.5, across: 'height', px: [7786, 5998] },
  { id: 'strip-window', caption: 'Fujifilm Pro 400H · 135', film: 35, across: 'height', px: [7446, 6873] },
  { id: 'strip-swing', caption: 'Kodak Portra 160 · 6×6', film: 61.5, across: 'height', px: [4864, 4993] },
  { id: 'strip-pair', caption: 'Kodak Portra 400 · 135 半格拼接', film: 35, across: 'width', px: [3469, 3755] },
  { id: 'bw-tmax', caption: 'Kodak T-Max 100 · 6×9 · 相纸 Ilford Multigrade IV RC', film: 61.5, across: 'height', px: [8604, 5996] },
  { id: 'strip-nyc-night', caption: 'Kodak Vision3 500T · 135 · 日期后背', film: 35, across: 'height', px: [8630, 7971] },
  { id: 'strip-trails', caption: 'Kodak Portra 800 · 6×9', film: 61.5, across: 'width', px: [5497, 7904] },
  { id: 'strip-skyline', caption: 'Fujifilm Pro 400H · 135', film: 35, across: 'height', px: [8636, 7971] },
  { id: 'strip-cliff', caption: 'Kodak Portra 400 · 6×6', film: 61.5, across: 'height', px: [5341, 5537] },
];

// The table, in mm.
const PANEL = 106; // height of the lit diffuser
const RIM = 2.6; // the aluminium frame around it
const DESK_TOP = 6, DESK_BOTTOM = 9; // desk in view above and below the box (more below, for its shadow)
const END = 24; // free diffuser before the first strip and after the last
const VIEW_H = PANEL + 2 * RIM + DESK_TOP + DESK_BOTTOM;
const VIEW_Y = (DESK_TOP - DESK_BOTTOM) / 2; // the box is centred on y = 0
const MAG = 3; // loupe magnification
const LENS_PAD = 1.5; // the loupe target spans 1.5 lens radii, for the refraction at the rim

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = Math.min(screen.width, screen.height) < 600;
const saveData = navigator.connection?.saveData === true;

// ------------------------------------------------------------------ shaders
const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const NOISE = /* glsl */ `
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}`;

// Desk, frame and diffuser. Everything is a function of the table position, so the loupe sees
// exactly what the main view does, only closer.
const PANEL_FRAG = /* glsl */ `
uniform vec2 uSpan;   // diffuser x0, x1
uniform vec4 uBox;    // diffuser half height, frame width, inner and outer corner radius
uniform vec2 uView;   // bottom and top of the main view, for the desk's light
varying vec2 vW;
${NOISE}
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
vec2 boxNormal(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  vec2 g = (q.x > 0. || q.y > 0.) ? normalize(max(q, 0.) + 1e-5) : (q.x > q.y ? vec2(1., 0.) : vec2(0., 1.));
  return g * sign(p + 1e-5);
}
void main() {
  vec2 c = vec2(.5 * (uSpan.x + uSpan.y), 0.);
  vec2 hb = vec2(.5 * (uSpan.y - uSpan.x), uBox.x);
  vec2 p = vW - c;
  float dIn = box(p, hb, uBox.z);
  float dOut = box(p, hb + uBox.y, uBox.w);
  float px = max(fwidth(dOut), 1e-4);

  // the desk: white, a little grey at the light box's exposure, in the box's soft shade
  float t = clamp((vW.y - uView.x) / (uView.y - uView.x), 0., 1.);
  vec3 col = mix(vec3(.918, .918, .925), vec3(.945, .945, .952), t);
  float dS = box(p - vec2(0., -2.4), hb + uBox.y, uBox.w);
  col *= 1. - .13 * exp(-max(dS, 0.) / 7.) - .14 * exp(-max(dOut, 0.) / .45);

  // the frame: thin anodised aluminium, the outer edge rolling away, a crest catching the room
  // light, brushed along its length, and a small step down to the diffuser
  float u = clamp(-dOut / uBox.y, 0., 1.);
  vec2 n = boxNormal(p, hb + uBox.y, uBox.w);
  float facing = dot(n, vec2(-.26, .966));
  float shade = .875 + .03 * facing;
  shade -= .13 * (1. - smoothstep(0., .18, u)) * (.75 - .25 * facing);
  shade += .09 * exp(-pow((u - .22) / .07, 2.)) * (.55 + .45 * facing);
  vec2 tg = vec2(-n.y, n.x);
  shade += (vnoise(vec2(dot(p, tg) * .3, dot(p, n) * 26.)) - .5) * .025;
  shade -= .2 * smoothstep(.8, .95, u) * (1. - smoothstep(.95, 1., u));
  vec3 rim = vec3(shade) * vec3(.985, .99, 1.);
  rim = mix(rim, vec3(1., .985, .96), .5 * smoothstep(.93, 1., u));

  // the diffuser: very bright, slightly warm, falling off softly towards the frame, a faint grain
  float inset = max(-dIn, 0.);
  float fall = smoothstep(0., 26., inset);
  float lum = mix(.95, 1., pow(fall, .7)) * (1. - .05 * exp(-inset / .5));
  vec3 lit = mix(vec3(.995, .975, .945), vec3(1., .997, .99), fall) * lum;
  lit += (vnoise(vW * 4.) - .5) * .014 + (hash(gl_FragCoord.xy) - .5) * .006;

  col = mix(col, rim, 1. - smoothstep(-px, px, dOut));
  col = mix(col, lit, 1. - smoothstep(-px, px, dIn));
  gl_FragColor = vec4(col, 1.);
}`;

// A strip: the film's transmittance times the light under it (MultiplyBlending, premultiplied),
// a gloss from the film base where the room's lamp reflects, light through the cut edge, and an
// anti-aliased edge (the quad is a little larger than the film).
const STRIP_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uLqip;
uniform float uMix;
uniform vec2 uSize;   // the strip, mm
uniform vec2 uQuad;   // the quad
uniform vec3 uSheen;  // lamp reflection (table mm) and its strength
uniform float uBias;  // mip bias: crisper in the loupe
varying vec2 vUv;
varying vec2 vW;
void main() {
  vec2 l = (vUv - .5) * uQuad;
  vec2 q = abs(l) - .5 * uSize;
  float d = max(q.x, q.y);
  float px = max(fwidth(d), 1e-4);
  float cov = 1. - smoothstep(-.5 * px, .5 * px, d);
  vec2 uv = clamp(l / uSize + .5, 0., 1.);
  uv.y = 1. - uv.y; // image bitmaps are uploaded top row first
  vec3 tr = mix(texture2D(uLqip, uv).rgb, texture2D(uMap, uv, uBias).rgb, uMix);
  vec2 s = vW - uSheen.xy;
  float broad = exp(-dot(s, s) / 2400.);
  vec2 r = mat2(.906, .423, -.423, .906) * s;
  float streak = exp(-(r.y * r.y) / 36. - (r.x * r.x) / 4200.);
  float gloss = uSheen.z * (.5 * broad + .7 * streak) + .01;
  vec3 col = tr + gloss * (1. - .8 * tr);
  col = mix(col, vec3(1., .99, .97), .22 * exp(min(d, 0.) / .22));
  gl_FragColor = vec4(col * cov, cov);
}`;

// The shadow of a strip lying a hair above the diffuser, in the room light: soft, faint,
// offset down, and never under the film itself (that would darken the transparency).
const SHADOW_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform vec2 uQuad;
uniform vec3 uShadow; // offset x, y and blur, mm
uniform float uAlpha;
varying vec2 vUv;
float sdBox(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }
void main() {
  vec2 l = (vUv - .5) * uQuad;
  float ds = sdBox(l - uShadow.xy, .5 * uSize - .5);
  float a = uAlpha * (1. - smoothstep(-.7 * uShadow.z, uShadow.z, ds));
  float dc = sdBox(l, .5 * uSize);
  a += .1 * exp(-max(dc, 0.) / .35);
  float px = max(fwidth(dc), 1e-4);
  a *= smoothstep(-.5 * px, .5 * px, dc);
  gl_FragColor = vec4(vec3(.11, .085, .06) * a, a);
}`;

// The loupe: the magnified target seen through a lens — a little barrel towards the edge with a
// chromatic fringe, a thick glass rim refracting what lies just outside, and a soft shadow.
const LOUPE_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vP;
void main() {
  vP = position.xy * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LOUPE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uR;     // lens radius, px
uniform float uRim;   // glass rim, px
uniform float uPad;   // target half-extent in lens radii
uniform float uA;     // fade
varying vec2 vP;
vec2 toUv(vec2 n) { return n / uPad * .5 + .5; }
void main() {
  float d = length(vP);
  float fw = max(fwidth(d), 1e-3);
  float r = d / uR;
  vec2 n = vP / uR;
  vec2 dir = vP / max(d, 1e-3);
  vec2 light = vec2(-.5, .866);

  vec2 b = n * (1. + .09 * r * r);
  float ca = .014 * r * r * r;
  vec3 lens = vec3(texture2D(uTex, toUv(b * (1. + ca))).r, texture2D(uTex, toUv(b)).g, texture2D(uTex, toUv(b * (1. - ca))).b);
  lens *= 1. - .14 * smoothstep(.72, 1., r);
  lens += .1 * smoothstep(.6, .97, r) * smoothstep(.3, .95, dot(dir, light));
  lens += .025 * (1. - smoothstep(0., .8, length(n - light * .45)));

  float tr = clamp((d - uR) / uRim, 0., 1.);
  vec3 rim = texture2D(uTex, toUv(dir * (1.24 + .18 * tr))).rgb;
  float facing = dot(dir, light) * .5 + .5;
  rim = mix(rim, vec3(1.), .5 + .3 * facing) * (.86 + .14 * facing);
  rim += .3 * exp(-pow((tr - .3) / .16, 2.)) * smoothstep(.5, 1., facing);

  vec3 col = mix(lens, rim, smoothstep(uR - fw, uR + fw, d));
  col *= 1. - .22 * (1. - smoothstep(0., 1.2 * fw + .4, abs(d - uR)));
  col *= 1. - .45 * (1. - smoothstep(0., 1.2 * fw + .4, abs(d - uR - uRim)));

  float disc = 1. - smoothstep(uR + uRim - fw, uR + uRim + fw, d);
  float sd = length(vP + vec2(0., 9.)) - (uR + uRim);
  float shadow = .17 * (1. - smoothstep(-12., 16., sd));
  gl_FragColor = vec4(col * disc, disc + shadow * (1. - disc)) * uA;
}`;

// ------------------------------------------------------------------ layout
function layout() {
  let seed = 0x5eed1e; // a fixed arrangement: the same table on every visit
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let x = END;
  const strips = STRIPS.map((s, i) => {
    const [pw, ph] = s.px;
    const w = s.across === 'height' ? (s.film * pw) / ph : s.film;
    const h = s.across === 'height' ? s.film : (s.film * ph) / pw;
    if (i) x += 13 + rnd() * 9; // a finger's width or two between strips
    const cx = x + w / 2;
    x += w;
    const room = Math.max(0, (PANEL - h) / 2 - 10);
    return { ...s, i, w, h, x: cx, y: (rnd() * 2 - 1) * Math.min(room, 6), tilt: ((rnd() * 2 - 1) * 1.1 * Math.PI) / 180 };
  });
  return { strips, length: x + END };
}

// 1440 or 1920 wide on a desktop (1920 for the big 120 formats, which the loupe needs), 960 on a phone.
function pickWidth(m, s) {
  const want = phone ? (saveData ? 480 : 960) : saveData ? 960 : s.w >= 75 ? 1920 : 1440;
  const fit = m.widths.filter((w) => w <= want);
  return fit.length ? Math.max(...fit) : Math.min(...m.widths);
}

function texture(bitmap, mipmaps) {
  const t = new Texture(bitmap);
  t.flipY = false; // uploaded top row first (image bitmaps ignore it anyway); the shader flips v
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ mount
export async function mount(root) {
  const section = root.closest('section') ?? document;
  const gallery = section.querySelector('.gallery');
  const stage = root.querySelector('.lt__stage');
  const canvas = root.querySelector('.lt__canvas');
  const bar = root.querySelector('.lt__bar');
  const caption = root.querySelector('.lt__caption');
  const count = root.querySelector('.lt__count');
  const hint = root.querySelector('.lt__hint');
  const live = root.querySelector('.lt__live');
  const list = root.querySelector('.lt__list');
  const [prevBtn, nextBtn] = root.querySelectorAll('.lt__btn');
  if (!stage || !canvas || !bar || !caption) return null;

  // WebGL 2 on real hardware, or nothing — quietly, so the gallery just stays.
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true });
  } catch { gl = null; }
  if (!gl) return null;
  const renderer = new WebGLRenderer({ canvas, context: gl });
  renderer.setClearColor(0xe9e9eb, 1);

  // The stage replaces the (much taller) gallery. If that happens above the viewport — someone
  // scrolling back up — keep what they are looking at still, where scroll anchoring does not.
  const below = section.getBoundingClientRect?.().bottom <= 0 ? section.nextElementSibling : null;
  const before = below?.getBoundingClientRect().top;
  root.hidden = false;
  if (gallery) gallery.hidden = true;
  if (below) {
    const shift = below.getBoundingClientRect().top - before;
    if (shift) window.scrollBy({ top: shift, behavior: 'instant' });
  }

  const ac = new AbortController();
  const { signal } = ac;
  const on = (el, type, fn, opts = {}) => el.addEventListener(type, fn, { ...opts, signal });
  const disposables = [];
  let destroyed = false, raf = 0, hintTimer = 0, longPress = 0, io = null, ro = null;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ac.abort();
    cancelAnimationFrame(raf);
    clearTimeout(hintTimer); clearTimeout(longPress);
    io?.disconnect(); ro?.disconnect();
    for (const d of disposables) d();
    renderer.dispose();
    renderer.forceContextLoss();
    stage.classList.remove('is-ready', 'is-loupe', 'is-dragging');
    list?.replaceChildren();
    root.hidden = true;
    if (gallery) gallery.hidden = false;
  }

  try {
    const { strips, length } = layout();
    const n = strips.length;

    // ------------------------------------------------------------- the scene
    const scene = new Scene();
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.set(0, VIEW_Y, 5);
    const quad = new PlaneGeometry(1, 1);
    const sheen = [0, 0, 0.075];
    const sheenU = { value: sheen };
    const biasU = { value: -0.35 };

    const panelMat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: PANEL_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uSpan: { value: [0, length] },
        uBox: { value: [PANEL / 2, RIM, 3, 3 + RIM] },
        uView: { value: [VIEW_Y - VIEW_H / 2, VIEW_Y + VIEW_H / 2] },
      },
    });
    const panel = new Mesh(quad, panelMat);
    panel.scale.set(length + 3000, VIEW_H + 400, 1);
    panel.position.set(length / 2, VIEW_Y, 0);
    scene.add(panel);

    const PAD = 0.8; // mm of quad beyond the cut edge, for its anti-aliasing
    const SH = [0.5, -1.1, 2.4]; // shadow offset and blur, mm
    for (const st of strips) {
      const qw = st.w + 2 * PAD, qh = st.h + 2 * PAD;
      st.mat = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: STRIP_FRAG,
        transparent: true, blending: MultiplyBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false,
        uniforms: { uMap: { value: null }, uLqip: { value: null }, uMix: { value: 0 }, uSize: { value: [st.w, st.h] }, uQuad: { value: [qw, qh] }, uSheen: sheenU, uBias: biasU },
      });
      const film = new Mesh(quad, st.mat);
      film.scale.set(qw, qh, 1);
      film.renderOrder = 2;
      const m = 2 * SH[2] + 2;
      const sw = st.w + 2 * m, sh = st.h + 2 * m;
      const shadowMat = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: SHADOW_FRAG,
        transparent: true, blending: NormalBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false,
        uniforms: { uSize: { value: [st.w, st.h] }, uQuad: { value: [sw, sh] }, uShadow: { value: SH }, uAlpha: { value: 0.16 } },
      });
      const shadow = new Mesh(quad, shadowMat);
      shadow.scale.set(sw, sh, 1);
      shadow.renderOrder = 1;
      for (const o of [film, shadow]) { o.position.set(st.x, st.y, 0); o.rotation.z = st.tilt; scene.add(o); }
      st.state = 'idle'; // → loading → ready → done; or failed, and it keeps its placeholder
      st.full = st.lqip = st.bitmap = null;
      st.fadeFrom = 0;
      disposables.push(() => { st.mat.dispose(); shadowMat.dispose(); st.full?.dispose(); st.lqip?.dispose(); st.lqip?.image?.close?.(); st.bitmap?.close?.(); });
    }

    // ------------------------------------------------------------- the loupe
    const rt = new WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
    const loupeCam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const overlay = new Scene();
    const ocam = new OrthographicCamera(0, 1, 0, -1, -10, 10);
    const loupeMat = new ShaderMaterial({
      vertexShader: LOUPE_VERT, fragmentShader: LOUPE_FRAG,
      transparent: true, blending: NormalBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: rt.texture }, uR: { value: 100 }, uRim: { value: 7 }, uPad: { value: LENS_PAD }, uA: { value: 0 }, uSize: { value: 1 } },
    });
    const lu = loupeMat.uniforms;
    const lens = new Mesh(quad, loupeMat);
    overlay.add(lens);
    disposables.push(() => { panelMat.dispose(); loupeMat.dispose(); quad.dispose(); rt.dispose(); });

    // --------------------------------------------------------- size and view
    let W = 0, H = 0, s = 1, viewW = 1, lo = 0, hi = 0, dpr = 0, R = 100, rimPx = 7;
    let x = 0, v = 0; // the camera's centre along the table (mm) and its velocity (mm/s)
    let drag = null, wheel = 0, lastWheel = -1e4, target = null;
    let measured = false, dirty = true;

    function measure() {
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const w = Math.round(r.width), h = Math.round(r.height), d = Math.min(devicePixelRatio || 1, phone ? 2 : 1.5); // 2 on a phone: the stage is small and the edge print must stay legible
      if (w === W && h === H && d === dpr) return false;
      W = w; H = h; dpr = d;
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false); // (this clears the canvas: callers draw right after)
      s = H / VIEW_H;
      viewW = W / s;
      lo = -RIM - DESK_TOP + viewW / 2; // at each end of the box, as much desk as above it
      hi = length + RIM + DESK_TOP - viewW / 2;
      if (hi < lo) lo = hi = (lo + hi) / 2;
      if (!measured) x = lo; // after that, the same point of the table stays in the middle
      if (!drag) { x = Math.min(hi, Math.max(lo, x)); if (target !== null) target = Math.min(hi, Math.max(lo, target)); }
      measured = true;
      cam.left = -viewW / 2; cam.right = viewW / 2; cam.top = VIEW_H / 2; cam.bottom = -VIEW_H / 2;
      cam.updateProjectionMatrix();
      ocam.right = W; ocam.bottom = -H;
      ocam.updateProjectionMatrix();
      R = W < 600 ? 72 : 102;
      rimPx = W < 600 ? 5 : 7;
      const size = Math.ceil(2 * LENS_PAD * R * dpr);
      rt.setSize(size, size);
      const span = (2 * LENS_PAD * R) / (s * MAG);
      loupeCam.left = -span / 2; loupeCam.right = span / 2; loupeCam.top = span / 2; loupeCam.bottom = -span / 2;
      loupeCam.updateProjectionMatrix();
      stage.style.setProperty('--lt-floor', `${Math.round((DESK_BOTTOM + RIM) * s)}px`); // the hint sits just inside the panel
      dirty = true;
      return true;
    }

    // -------------------------------------------------------------- textures
    const FORMATS = ['avif', 'webp'];
    let fmt = 0; // steps to WebP, then to the JPEG fallback, the first time a format does not decode
    let inflight = 0, lost = false;
    const ready = [];
    const away = (st) => Math.max(0, Math.abs(st.x - x) - st.w / 2);

    async function decode(blob) { // off the main thread; null if this browser cannot decode the format
      try { return await createImageBitmap(blob); } catch { /* try an image element */ }
      const src = URL.createObjectURL(blob);
      try { const img = new Image(); img.src = src; await img.decode(); return img; } catch { return null; } finally { URL.revokeObjectURL(src); }
    }
    async function bitmapFrom(url, priority) {
      const res = await fetch(url, { signal, priority });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return decode(await res.blob());
    }
    async function loadFull(st) {
      const m = manifest[st.id];
      const w = pickWidth(m, st);
      const priority = away(st) < viewW ? 'high' : 'low';
      for (;;) {
        const f = fmt;
        const url = f < FORMATS.length ? `${m.dir}/${st.id}-${w}.${FORMATS[f]}` : `${m.dir}/${st.id}-${m.fallback.width}.${m.fallback.ext}`;
        const bmp = await bitmapFrom(url, priority);
        if (bmp) return bmp;
        if (f >= FORMATS.length) throw new Error(`cannot decode ${url}`);
        if (fmt === f) fmt++;
      }
    }
    function pump() { // three at a time, nearest to the view first
      while (inflight < 3 && !destroyed) {
        let next = null;
        for (const st of strips) if (st.state === 'idle' && (!next || away(st) < away(next))) next = st;
        if (!next) return;
        const st = next;
        st.state = 'loading';
        inflight++;
        loadFull(st)
          .then((bmp) => { if (destroyed) return bmp.close?.(); st.bitmap = bmp; st.state = 'ready'; ready.push(st); kick(); })
          .catch(() => { st.state = 'failed'; })
          .finally(() => { inflight--; pump(); });
      }
    }
    function upload(now) { // one upload (and its mipmaps) per frame, nearest first
      if (!ready.length || lost) return false;
      let k = 0;
      for (let i = 1; i < ready.length; i++) if (away(ready[i]) < away(ready[k])) k = i;
      const st = ready.splice(k, 1)[0];
      const t = texture(st.bitmap, true);
      renderer.initTexture(t);
      st.bitmap.close?.(); // the GPU has it now
      st.bitmap = null;
      st.full?.dispose();
      st.full = t;
      st.mat.uniforms.uMap.value = t;
      st.fadeFrom = now;
      st.state = 'done';
      return true;
    }
    const placeholders = Promise.all(strips.map(async (st) => {
      try {
        const bmp = await decode(await (await fetch(manifest[st.id].lqip, { signal })).blob());
        if (!bmp || destroyed) return bmp?.close?.();
        st.lqip = texture(bmp, false);
        st.mat.uniforms.uLqip.value = st.lqip;
        if (!st.full) st.mat.uniforms.uMap.value = st.lqip;
      } catch { /* the full rendition will do */ }
    }));

    // ------------------------------------------------------------- the loop
    let last = 0, lastDraw = 0, visible = false;
    const running = () => visible && !document.hidden && !lost && !destroyed;
    function kick() {
      if (!raf && running()) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }

    const pointer = { in: false, mouse: false, lx: 0, ly: 0, cx: 0, cy: 0 };
    const loupe = { on: 0, a: 0, touch: false };
    let hover = -1, selected = -1, shownIdx = -1, interacted = false;
    let sheenX = 0, sheenY = 0, sheenGain = 0.075;

    // Past either end the table gives, like the edge of a scroll view, and springs back.
    const D = () => viewW * 0.45;
    const band = (o) => (1 - 1 / ((o * 0.55) / D() + 1)) * D();
    const unband = (o) => (o >= D() * 0.999 ? 1e5 : (D() * (1 / (1 - o / D()) - 1)) / 0.55);
    function push(x0, d) {
      if (d > 0 && x0 + d > hi) return hi + band(unband(Math.max(0, x0 - hi)) + d - Math.max(0, hi - x0));
      if (d < 0 && x0 + d < lo) return lo - band(unband(Math.max(0, lo - x0)) - d - Math.max(0, x0 - lo));
      return x0 + d;
    }
    function spring(to, w, dt) { // critically damped, in small steps
      for (let t = dt; t > 0; t -= 1 / 120) {
        const h = Math.min(t, 1 / 120);
        v += (w * w * (to - x) - 2 * w * v) * h;
        x += v * h;
      }
      if (Math.abs(to - x) < 0.02 && Math.abs(v) < 1) { x = to; v = 0; return true; }
      return false;
    }
    function physics(dt, now) {
      const x0 = x;
      if (wheel) { // wheel and trackpad deltas, smoothed a little
        let step = reduce ? wheel : wheel * (1 - Math.exp(-dt / 0.06));
        if (Math.abs(wheel - step) < 0.01) step = wheel;
        wheel -= step;
        x = push(x, step);
      }
      const wheeling = now - lastWheel < 110;
      if (!drag && target !== null) {
        if (reduce) { x = target; v = 0; target = null; } else if (spring(target, 13, dt)) target = null;
      } else if (!drag && !wheeling && !wheel) {
        const bound = x < lo ? lo : x > hi ? hi : null;
        if (bound !== null) { if (reduce) { x = bound; v = 0; } else spring(bound, 12, dt); }
        else if (v) { // inertia
          x += v * dt;
          v *= Math.exp(-dt / 0.33);
          if (Math.abs(v) < 1.5) v = 0;
        }
      }
      if (x !== x0) dirty = true;
      return !!drag || !!wheel || wheeling || target !== null || v !== 0 || x < lo - 1e-3 || x > hi + 1e-3;
    }

    const toWorld = (lx, ly) => [x + (lx - W / 2) / s, VIEW_Y - (ly - H / 2) / s];
    function hit(lx, ly) {
      const [wx, wy] = toWorld(lx, ly);
      for (const st of strips) {
        const dx = wx - st.x, dy = wy - st.y, c = Math.cos(st.tilt), sn = Math.sin(st.tilt);
        if (Math.abs(dx * c + dy * sn) <= st.w / 2 && Math.abs(-dx * sn + dy * c) <= st.h / 2) return st.i;
      }
      return -1;
    }
    function nearest() {
      let best = 0, bd = Infinity;
      for (const st of strips) {
        const d = away(st) * 1000 + Math.abs(st.x - x);
        if (d < bd) { bd = d; best = st.i; }
      }
      return best;
    }
    const onTable = (lx, ly) => {
      const [wx, wy] = toWorld(lx, ly);
      return Math.abs(wy) <= PANEL / 2 + RIM && wx >= -RIM && wx <= length + RIM;
    };

    function frame(now) {
      raf = 0;
      if (!running()) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      let busy = physics(dt, now);

      // the loupe fades in and out; it follows the pointer exactly
      const la = loupe.a;
      loupe.a = reduce ? loupe.on : loupe.a + (loupe.on - loupe.a) * (1 - Math.exp(-dt / 0.07));
      if (Math.abs(loupe.a - loupe.on) < 0.004) loupe.a = loupe.on;
      if (loupe.a !== la) dirty = true;
      busy ||= loupe.a !== loupe.on;

      // the gloss: a lamp over the top left of the view reflects half way between itself and the
      // eye, which the pointer stands in for; with no pointer the eye drifts, slowly
      let drift = false;
      let ex = x, ey = VIEW_Y;
      if (pointer.in) [ex, ey] = toWorld(pointer.lx, pointer.ly);
      else if (!reduce) {
        const t = now / 1000;
        ex += Math.sin(t * 0.21) * viewW * 0.3;
        ey += Math.cos(t * 0.17) * VIEW_H * 0.25;
        drift = true;
      }
      const tx = (x - viewW * 0.32 + ex) / 2, ty = (VIEW_Y + VIEW_H * 0.4 + ey) / 2;
      const gain = pointer.in ? 0.11 : 0.075;
      const k = reduce ? 1 : 1 - Math.exp(-dt / (pointer.in ? 0.09 : 0.6));
      sheenX += (tx - sheenX) * k; sheenY += (ty - sheenY) * k; sheenGain += (gain - sheenGain) * k;
      const off = Math.abs(tx - sheenX) + Math.abs(ty - sheenY) + 100 * Math.abs(gain - sheenGain);
      if (off > 0.02 || drift) dirty = true;
      if (off > 0.02 && !drift) busy = true;

      // textures: one upload a frame, then a short cross-fade from the placeholder
      if (upload(now)) { dirty = true; busy = true; }
      busy ||= ready.length > 0;
      for (const st of strips) {
        if (!st.fadeFrom) continue;
        const f = reduce ? 1 : Math.min(1, (now - st.fadeFrom) / 450);
        st.mat.uniforms.uMix.value = f * f * (3 - 2 * f);
        if (f >= 1) st.fadeFrom = 0; else busy = true;
        dirty = true;
      }

      if (pointer.in && pointer.mouse) hover = hit(pointer.lx, pointer.ly);
      ui();

      // when nothing but the slow drift moves, 30 frames a second is plenty
      if (dirty && (busy || now - lastDraw >= 30)) { draw(); lastDraw = now; }
      if (busy || drift) raf = requestAnimationFrame(frame);
    }

    function draw() {
      dirty = false;
      cam.position.x = x;
      sheen[0] = sheenX; sheen[1] = sheenY; sheen[2] = sheenGain;
      const showLoupe = loupe.a > 0.003;
      if (showLoupe) {
        const [wx, wy] = toWorld(pointer.lx, pointer.ly);
        loupeCam.position.set(wx, wy, 5);
        biasU.value = -1;
        renderer.setRenderTarget(rt);
        renderer.render(scene, loupeCam);
        renderer.setRenderTarget(null);
        biasU.value = -0.35;
      }
      renderer.render(scene, cam);
      if (!showLoupe) return;
      const grow = reduce ? 1 : 0.86 + 0.14 * loupe.a;
      const out = R + rimPx + 2;
      let cx = pointer.lx, cy = pointer.ly;
      if (loupe.touch) cy = cy - R - 40 < out ? cy + R + 40 : cy - R - 40; // clear of the finger
      cx = Math.min(W - out, Math.max(out, cx)); // whole, even at the stage's edges
      cy = Math.min(H - out, Math.max(out, cy));
      lu.uR.value = R * grow;
      lu.uRim.value = rimPx * grow;
      lu.uSize.value = 2 * (lu.uR.value + lu.uRim.value + 36);
      lu.uA.value = loupe.a;
      lens.scale.set(lu.uSize.value, lu.uSize.value, 1);
      lens.position.set(cx, -cy, 0);
      renderer.autoClear = false;
      renderer.render(overlay, ocam);
      renderer.autoClear = true;
    }

    // --------------------------------------------------------------- the UI
    function setCaption(i) {
      const c = strips[i].caption, cut = c.indexOf(' · ');
      const strong = document.createElement('strong');
      strong.textContent = cut < 0 ? c : c.slice(0, cut);
      caption.replaceChildren(strong, cut < 0 ? '' : c.slice(cut));
      if (count) count.textContent = `${i + 1} / ${n}`;
    }
    let atStart = null, atEnd = null;
    const current = () => (selected >= 0 ? selected : nearest());
    function ui() { // the strip under the pointer, else the one chosen, else the one in the middle
      const c = current();
      const i = hover >= 0 ? hover : c;
      if (i !== shownIdx) { shownIdx = i; setCaption(i); }
      if ((c === 0) !== atStart) { atStart = c === 0; prevBtn?.setAttribute('aria-disabled', String(atStart)); }
      if ((c === n - 1) !== atEnd) { atEnd = c === n - 1; nextBtn?.setAttribute('aria-disabled', String(atEnd)); }
    }
    function go(i, announce) { // bring strip i to the middle (as far as the ends allow) and name it
      i = Math.max(0, Math.min(n - 1, i));
      selected = i;
      target = Math.min(hi, Math.max(lo, strips[i].x));
      v = 0; wheel = 0;
      if (announce && live) live.textContent = `${strips[i].caption}，第 ${i + 1} 条，共 ${n} 条`;
      touched();
      kick();
    }
    const step = (dir) => go(current() + dir, true);

    let hintShown = false;
    try { hintShown = sessionStorage.getItem('lt-hint') === '1'; } catch { /* storage blocked */ }
    function showHint() { // once: on a vertical wheel over the table, or after a while in view untouched
      if (hintShown || interacted || !hint) return;
      hintShown = true;
      try { sessionStorage.setItem('lt-hint', '1'); } catch { /* fine */ }
      hint.classList.add('is-on');
      hintTimer = setTimeout(hideHint, 3800);
    }
    function hideHint() { clearTimeout(hintTimer); hint?.classList.remove('is-on'); }
    function touched() { interacted = true; hideHint(); }

    // ----------------------------------------------------------- the events
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const track = (e) => { [pointer.lx, pointer.ly] = local(e); pointer.cx = e.clientX; pointer.cy = e.clientY; };
    const samples = [];
    function setLoupe(onOff, touchMode = false) {
      loupe.on = onOff ? 1 : 0;
      loupe.touch = touchMode;
      stage.classList.toggle('is-loupe', onOff && !touchMode);
      kick();
    }

    on(stage, 'pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      track(e);
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: x, t0: performance.now(), moved: false, type: e.pointerType };
      samples.length = 0;
      samples.push([performance.now(), x]);
      target = null; v = 0; wheel = 0;
      if (e.pointerType === 'mouse') stage.setPointerCapture(e.pointerId);
      else {
        clearTimeout(longPress);
        longPress = setTimeout(() => { // touch and hold: the loupe, and the finger moves it instead of the table
          if (!drag || drag.moved) return;
          drag.loupe = true;
          pointer.in = true;
          setLoupe(true, true);
        }, 420);
      }
      touched();
      kick();
    });
    on(stage, 'pointermove', (e) => {
      if (e.pointerType === 'mouse' && !drag) {
        track(e);
        pointer.in = true; pointer.mouse = true;
        setLoupe(onTable(pointer.lx, pointer.ly));
        dirty = true;
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      track(e);
      if (drag.loupe) { dirty = true; kick(); return; }
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) + Math.abs(e.clientY - drag.y0) > 4) {
        drag.moved = true;
        selected = -1;
        clearTimeout(longPress);
        stage.classList.add('is-dragging');
        if (e.pointerType === 'mouse') setLoupe(false);
      }
      if (!drag.moved) return;
      x = push(drag.from, -dx / s);
      const now = performance.now();
      samples.push([now, drag.from - dx / s]);
      while (samples.length > 2 && now - samples[0][0] > 90) samples.shift();
      dirty = true;
      kick();
    });
    function endDrag(e, cancelled) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      clearTimeout(longPress);
      const d = drag;
      drag = null;
      stage.classList.remove('is-dragging');
      if (d.loupe) { setLoupe(false); pointer.in = false; }
      else if (d.moved && !cancelled && !reduce) { // fling
        const now = performance.now(), a = samples[0], b = samples[samples.length - 1];
        const span = (b[0] - a[0]) / 1000, cap = 5200 / s;
        v = span > 0.008 && now - b[0] < 60 ? Math.max(-cap, Math.min(cap, (b[1] - a[1]) / span)) : 0;
      } else if (!d.moved && !cancelled && performance.now() - d.t0 < 450) {
        const i = hit(pointer.lx, pointer.ly); // a click or a tap brings that strip to the middle
        if (i >= 0) go(i, false);
      }
      if (d.type === 'mouse' && !cancelled) setLoupe(onTable(pointer.lx, pointer.ly));
      kick();
    }
    on(stage, 'pointerup', (e) => endDrag(e, false));
    on(stage, 'pointercancel', (e) => endDrag(e, true)); // the browser took the gesture: a vertical page scroll
    on(stage, 'lostpointercapture', (e) => { if (drag?.type === 'mouse') endDrag(e, false); });
    on(stage, 'pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || drag) return;
      pointer.in = false; hover = -1;
      setLoupe(false);
    });
    on(window, 'scroll', () => { // the page moved under a still mouse
      if (!pointer.in || !pointer.mouse || drag) return;
      track({ clientX: pointer.cx, clientY: pointer.cy });
      const outside = pointer.lx < 0 || pointer.ly < 0 || pointer.lx > W || pointer.ly > H;
      if (outside) { pointer.in = false; hover = -1; }
      setLoupe(!outside && onTable(pointer.lx, pointer.ly));
      dirty = true;
    }, { passive: true });
    on(stage, 'touchmove', (e) => { if (drag?.loupe && e.cancelable) e.preventDefault(); }, { passive: false });
    on(stage, 'contextmenu', (e) => { if (drag?.loupe || loupe.touch) e.preventDefault(); });

    on(stage, 'wheel', (e) => {
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? W : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      const dy = e.shiftKey ? 0 : e.deltaY * unit;
      if (Math.abs(dx) > Math.abs(dy) && e.cancelable) {
        e.preventDefault(); // sideways is the table's (and never the browser's back gesture)
        target = null; selected = -1; v = 0;
        wheel += dx / s;
        lastWheel = performance.now();
        touched();
        kick();
      } else if (Math.abs(dy) > 2) {
        showHint(); // a plain vertical wheel scrolls the page, as it should
      }
    }, { passive: false });

    on(stage, 'keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'Home') go(0, true);
      else if (e.key === 'End') go(n - 1, true);
      else return;
      e.preventDefault();
    });
    if (prevBtn) on(prevBtn, 'click', () => { if (prevBtn.getAttribute('aria-disabled') !== 'true') step(-1); });
    if (nextBtn) on(nextBtn, 'click', () => { if (nextBtn.getAttribute('aria-disabled') !== 'true') step(1); });

    on(document, 'visibilitychange', () => { dirty = true; kick(); });
    io = new IntersectionObserver((entries) => { // the loop only runs while the stage is on screen
      for (const e of entries) {
        visible = e.isIntersecting;
        if (visible) { dirty = true; kick(); }
        if (e.intersectionRatio >= 0.6 && !interacted) setTimeout(() => { if (visible) showHint(); }, 1400);
      }
    }, { threshold: [0, 0.6] });
    io.observe(stage);
    const resized = () => { if (measure() && !lost) { draw(); kick(); } };
    ro = new ResizeObserver(resized);
    ro.observe(stage);
    on(window, 'resize', resized, { passive: true }); // also catches a move to a display with another pixel ratio

    on(canvas, 'webglcontextlost', () => { // three.js restores the context; the textures come back from the cache
      lost = true;
      cancelAnimationFrame(raf); raf = 0;
      for (const st of strips) {
        if (st.state === 'done') { st.full?.dispose(); st.full = null; st.state = 'idle'; }
        st.mat.uniforms.uMap.value = st.lqip;
        st.mat.uniforms.uMix.value = 0;
        st.fadeFrom = 0;
      }
    });
    on(canvas, 'webglcontextrestored', () => { lost = false; dirty = true; pump(); kick(); });

    // ----------------------------------------------------------------- start
    list?.replaceChildren(...strips.map((st) => { // for screen readers: every strip, with the page's own description of it
      const li = document.createElement('li');
      const alt = gallery?.querySelector(`img[src*="/${st.id}/"]`)?.alt;
      li.textContent = alt ? `${st.caption}：${alt}` : st.caption;
      return li;
    }));
    measure();
    sheenX = x - viewW * 0.16; sheenY = VIEW_Y + VIEW_H * 0.2;
    setCaption(shownIdx = nearest());
    await Promise.race([placeholders, new Promise((r) => setTimeout(r, 800))]);
    if (destroyed) return null;
    pump();
    draw();
    kick();
    requestAnimationFrame(() => stage.classList.add('is-ready'));
    return { destroy };
  } catch (err) {
    destroy(); // back to the gallery
    throw err;
  }
}
