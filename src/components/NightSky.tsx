import { useEffect, useRef } from 'react'
import { useSettings } from '../store'

/* The night sky behind the player: a twinkling starfield over a deep navy
 * gradient, a moon with a soft halo, and cumulus that cover the stars and
 * pick up a silver edge where they pass near it.
 *
 * This is Originkit's Cloud Sky 3 brought over whole - its fragment program,
 * its constants and its own notes - rather than an impression of it redrawn
 * in 2D. The first attempt here was that impression, and it is instructive
 * why it fell short: what makes these clouds read as cumulus is a per-pixel
 * field with an asymmetric puff profile, two-band erosion and a soft-max
 * blend across a 5x5 cell window, and none of that survives being
 * approximated with a few dozen baked sprites.
 *
 * What is ours is the housing. It hangs off the `nightSky` setting, sits
 * behind every panel, caps its frame rate - nothing in this sky moves fast
 * enough to want more - honours "go easy on the machine" and the
 * pause-while-unfocused switch, and reads the pointer from the window,
 * because our canvas takes no events of its own.
 *
 * If WebGL is missing it draws nothing and the ordinary background shows
 * through, which is the right failure: a sky is not worth a blank window. */

const FRAME_MS = 1000 / 32 - 1
const ECO_MS = 1000 / 20 - 1
const MAX_DPR = 2

// The preset the component ships with, as its panel reports it.
const BACKGROUND = '#050A1A'   // zenith
const BASE_COLOR = '#1C2B4D'   // horizon
const ACCENT_COLOR = '#2E3850' // the cloud masses
const DENSITY = 40
const SPEED = 50
const SIZE = 100
const STARS = 40
const CLOUD_SOFTNESS = 100
const CLOUD_SHADOW = 100
const MOON_POS = { x: 26, y: 76, glow: 'rgba(214, 228, 255, 0.9)' }
const PTR = { parallax: 100, wind: 100, damping: 20 }
/* Ours, not theirs. The component has one Speed, and it drives the drift and
   the twinkle together - turning it down to slow the clouds would also slow
   the stars, which are already as calm as they should be. So the drift gets
   its own scale and Speed stays at the preset. */
const DRIFT_SCALE = 0.62

/* ─── everything from here to the end of FRAG_SRC is the component's own,
       constants and comments included: they are the reasons the look holds
       together, and paraphrasing them would lose the measurements. ─── */

const PUFF_UP = 0.34 // ellipse radius above the puff centre
const PUFF_DOWN = 0.19 // ...and below it. The gap IS the flat cumulus base.
const ERODE = 0.7 // how hard the fbm eats into the blob edge
const SHADOW_STEP = 0.085 // how far above a pixel the self-shadow samples
const NEAR_CELL = 1.05 // cells across the short side, near layer
const FAR_CELL = 2.15 // ...and far layer
const FAR_MIX = 0.55 // aerial perspective: far cloud mixed toward the sky
const NEAR_DRIFT = 0.055 // cells/sec at Speed 50
const FAR_DRIFT = 0.026
// A puff's half-width in cells. Clamped so the 5x5 neighbourhood below is
// PROVABLY enough: a puff at cell offset o reaches this pixel whenever its
// half-width exceeds |o| - 0.85, so a cell at |o| = 3 can only matter once w
// passes 2.15. Uncapped, w hits 0.72 * 3.0 = 2.16 at Size 300 and the widest
// puffs get silently dropped -- measured against a wide-window ground truth,
// 0.025% of pixels wrong with a worst error of 0.40, which paints as one hard
// arc through the cloud.
const PUFF_WMAX = 2.15
// Sharpness of the soft-max that blends each puff's height contribution. See
// blobs(): winner-take-all is what put the creases in the cloud body. Picked on
// a sweep -- at 12 the crease count is 0 at every Size while the puff's own
// top-to-bottom gradient keeps 91% of its spread; lower blurs the gradient away,
// higher lets the jump climb back.
const SHADE_BLEND = 12.0
const STAR_GRID = 90 // star candidates per frame height
const MOON_R = 0.045 // moon disc radius, fraction of frame height
const TWINKLE = 1.2 // twinkle clock, radians/sec at Speed 50

const VERT_SRC = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uNearX, uFarX, uTime;
uniform float uCoverage, uSize, uSoftness, uShadow, uStars;
uniform vec3 uZenith, uHorizon, uCloud;
uniform vec4 uGlow;
uniform vec2 uSun;   // the moon
uniform vec2 uParallax;

// No sin() in the hash: fract(sin(x) * k) quantizes hard once the argument gets
// large, and the cell ids run far off the origin as the sky drifts.
vec2 hash22(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// One hashed puff cluster per cell, walked over the neighbourhood so a puff near
// an edge is still drawn by the cell next door. Most cells are empty -- that is
// what leaves real sky between the clouds.
// Returns (coverage, height within the puff). The second component is what shades
// the cloud: -1 at its base, +1 at its crown. Without it the only shading signal
// is "is there cloud above me", which is true almost everywhere inside a puff, so
// the whole body goes grey and only a one-pixel rim stays white.
//
// THE WINDOW is 5x5, not 3x3, with an exact reach test that skips a cell before
// it costs a hash. A 3x3 window only serves puffs up to 1.85 cells wide; past
// that the widest puffs are dropped and their ellipses end on a hard arc. The
// test is |o| <= w + 0.85, so small sizes cost LESS than the old 3x3 (at Size 20
// only the centre cell can reach at all) and only Size 200+ pays for the ring.
//
// THE HEIGHT is a soft-max blend over every puff, not the nearest puff's. Taking
// it from the winner makes it jump the instant two overlapping puffs swap which
// one is nearest -- measured up to 1.43 across a single pixel -- and shadeCloud
// turns that discontinuity into a hard crease straight across the cloud body.
// That is what appears as Size grows: at Size 100 the puffs barely overlap and
// there are none, at 200 there are 458 and at 300 there are 1585.
//
// The soft-max is the ONLINE form, rescaling the running sums whenever a new
// best arrives, so the dominant weight is always exactly 1.0 and the sums stay
// in [1, 25]. The plain exp(K * val) form overflows outright on a mediump
// fragment path, and its smallest weights flush to zero exactly at the cloud
// edge where the height still has to be right.
vec2 blobs(vec2 uv, float seed){
  vec2 id = floor(uv), f = fract(uv);
  // Sentinel stays small: -1e9 is outside mediump's guaranteed range, and val
  // never falls below about -50 here.
  float best = -1e4;
  float wsum = 0.0, ysum = 0.0;
  float wMax = min(${PUFF_WMAX.toFixed(3)}, 0.72 * uSize);
  float reach = min(2.0, ceil(wMax + 0.85) - 1.0);
  for (int j = -2; j <= 2; j++){
    for (int i = -2; i <= 2; i++){
      vec2 o = vec2(float(i), float(j));
      if (max(abs(o.x), abs(o.y)) > reach) continue;
      vec2 h = hash22(id + o + seed);
      // Coverage decides how many cells hold a cloud at all.
      if (fract(h.x * 37.1) > uCoverage) continue;
      vec2 c = o + 0.15 + h * 0.7;
      float w = min(${PUFF_WMAX.toFixed(3)}, (0.30 + 0.42 * fract(h.y * 19.7)) * uSize);
      vec2 d = f - c;
      // Asymmetric about the centre: tall above, short below. That gap is the
      // flat base a cumulus has and a noise field never produces.
      float ry = (d.y > 0.0 ? ${PUFF_UP.toFixed(3)} : ${PUFF_DOWN.toFixed(3)}) * uSize * (0.8 + 0.5 * fract(h.y * 7.3));
      float e = length(vec2(d.x / max(w, 1e-3), d.y / max(ry, 1e-3)));
      float val = 1.0 - e;
      float yN = d.y / max(ry, 1e-3);
      if (val > best){
        float k = exp(${SHADE_BLEND.toFixed(1)} * (best - val));
        wsum = wsum * k + 1.0;
        ysum = ysum * k + yN;
        best = val;
      } else {
        float g = exp(${SHADE_BLEND.toFixed(1)} * (val - best));
        wsum += g;
        ysum += g * yN;
      }
    }
  }
  return vec2(best, ysum / max(wsum, 1e-4));
}

// Blobs decide WHERE, noise decides the OUTLINE.
vec2 cloudField(vec2 uv, float seed, float detailScale){
  vec2 b = blobs(uv, seed);
  // Two bands: the coarse one dents the silhouette into lobes, the fine one
  // frays it. One band alone gives either a wobbly outline or fuzz, never the
  // feathered edge a cumulus has.
  float n = fbm(uv * detailScale + seed * 3.1) * 0.72
          + fbm(uv * detailScale * 3.3 + seed * 7.7) * 0.28;
  return vec2(b.x - (1.0 - n) * ${ERODE.toFixed(3)}, b.y);
}

// Moonlit from above: a dark body whose crown catches moonlight, and a silver
// fringe on whatever passes near the moon.
vec3 shadeMoon(float dyNorm, vec3 sky, vec2 p, vec2 moonP, float a){
  float t = smoothstep(-0.95, 0.4, dyNorm);
  vec3 base = mix(uCloud * 0.45, sky, 0.3);
  vec3 body = mix(mix(uCloud, base, uShadow), uCloud, t);
  float d = length(p - moonP);
  vec3 g = uGlow.rgb * uGlow.a;
  // The lining falls off much faster than the crown light, so only clouds
  // actually near the moon get a silver edge.
  body += g * (a * (1.0 - a) * 4.0 * exp(-d * 3.5) * 1.0 + t * exp(-d * 2.2) * 0.12);
  return body;
}

float starField(vec2 p){
  vec2 gp = p * ${STAR_GRID.toFixed(1)};
  vec2 id = floor(gp);
  vec2 f = fract(gp) - 0.5;
  vec2 h = hash22(id + 71.0);
  if (h.x > uStars * 0.5) return 0.0;
  vec2 o = (hash22(id + 13.0) - 0.5) * 0.6;
  float d = length(f - o);
  float s = mix(0.05, 0.16, pow(fract(h.y * 13.1), 3.0));
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + 2.5 * fract(h.x * 91.7)) + h.y * 6.2831);
  return exp(-d * d / (s * s)) * tw * (0.35 + 0.65 * fract(h.y * 5.3));
}

void main(){
  vec2 frag = gl_FragCoord.xy / max(uRes.y, 1.0);
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(frag.x, frag.y);

  // ---- sky ---------------------------------------------------------------
  vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.1, 0.9, p.y));
  vec2 moonP = vec2(uSun.x * aspect, uSun.y);
  float md = length(p - moonP);
  vec3 g = uGlow.rgb * uGlow.a;
  float halo = exp(-md * 5.0) * 0.5 + exp(-md * 1.6) * 0.15;
  sky += g * halo;

  // What the clouds are shaded against: the sky WITHOUT stars and moon disc,
  // or a cloud's underside would pick up a starfield tint.
  vec3 skyBase = sky;

  float st = starField(p + uParallax * 0.08)
           * smoothstep(0.05, 0.45, p.y)
           * (1.0 - clamp(halo * 2.0, 0.0, 1.0));
  sky += vec3(st);

  float disc = 1.0 - smoothstep(${MOON_R.toFixed(4)} - 0.002, ${MOON_R.toFixed(4)} + 0.002, md);
  float maria = 0.82 + 0.18 * fbm((p - moonP) * 40.0 + 3.0);
  sky = mix(sky, mix(uGlow.rgb, vec3(1.0), 0.35) * maria, disc * uGlow.a);

  vec3 col = sky;

  // ---- far cumulus -------------------------------------------------------
  vec2 fuv = vec2(p.x + uFarX, p.y) * ${FAR_CELL.toFixed(3)} + uParallax * 0.4;
  vec2 fd = cloudField(fuv, 17.0, 11.0);
  float fa = clamp(fd.x * uSoftness, 0.0, 1.0);
  if (fa > 0.0) {
    vec3 lit = shadeMoon(fd.y, skyBase, p, moonP, fa);
    col = mix(col, mix(lit, skyBase, ${FAR_MIX.toFixed(3)}), fa);
  }

  // ---- near cumulus ------------------------------------------------------
  vec2 nuv = vec2(p.x + uNearX, p.y) * ${NEAR_CELL.toFixed(3)} + uParallax;
  vec2 nd = cloudField(nuv, 3.0, 8.5);
  float na = clamp(nd.x * uSoftness, 0.0, 1.0);
  if (na > 0.0) {
    vec3 lit = shadeMoon(nd.y, skyBase, p, moonP, na);
    float above = clamp(cloudField(nuv + vec2(0.0, ${SHADOW_STEP.toFixed(3)}), 3.0, 8.5).x * uSoftness, 0.0, 1.0);
    lit *= 1.0 - 0.18 * uShadow * above;
    col = mix(col, lit, na);
  }

  gl_FragColor = vec4(col, 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('NightSky shader:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

type RGBA = [number, number, number, number]

function parseColor(input: string | undefined, fb: RGBA): RGBA {
  if (!input) return fb
  const str = String(input).trim()
  if (str.charAt(0) === '#') {
    let hex = str.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + (hex.length === 4 ? hex[3] + hex[3] : '')
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r / 255, g / 255, b / 255, a]
    }
    return fb
  }
  const m = str.match(/[\d.]+/g)
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])) / 255,
      Math.min(255, parseFloat(m[1])) / 255,
      Math.min(255, parseFloat(m[2])) / 255,
      m.length >= 4 ? Math.min(1, parseFloat(m[3])) : 1,
    ]
  }
  return fb
}

export function NightSky() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const pauseBg = useSettings(s => s.seasonPauseBg)
  const eco = useSettings(s => s.seasonEco)
  const pause = useRef(pauseBg); pause.current = pauseBg
  const ecoRef = useRef(eco); ecoRef.current = eco

  useEffect(() => {
    const canvas = cvRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false })
    if (!gl) return

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vs || !fs) return
    const prog = gl.createProgram()
    if (!prog) return
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('NightSky link:', gl.getProgramInfoLog(prog))
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const locs: Record<string, WebGLUniformLocation | null> = {}
    const u = (name: string) => {
      if (!(name in locs)) locs[name] = gl.getUniformLocation(prog, name)
      return locs[name]
    }

    const zen = parseColor(BACKGROUND, [0.02, 0.04, 0.1, 1])
    const hor = parseColor(BASE_COLOR, [0.11, 0.17, 0.3, 1])
    const cld = parseColor(ACCENT_COLOR, [0.18, 0.22, 0.31, 1])
    const glow = parseColor(MOON_POS.glow, [0.84, 0.89, 1, 0.9])
    const coverage = DENSITY / 100
    const speed = SPEED / 50
    const size = SIZE / 100
    const starAmt = STARS / 100
    const softness = 4.5 / Math.max(0.15, CLOUD_SOFTNESS / 100)
    const shadow = CLOUD_SHADOW / 100
    const sunX = MOON_POS.x / 100
    const sunY = MOON_POS.y / 100
    const parallax = PTR.parallax / 100
    const wind = PTR.wind / 100
    const damping = PTR.damping

    let raf = 0, stopped = false
    let last = performance.now()
    // Each layer keeps its OWN accumulator, wrapped on the CPU. One shared
    // clock scaled per layer would jump every time Speed changed, because the
    // scale multiplies the whole elapsed time, not just what comes next.
    let nearX = 0, farX = 0, twinkle = 0, leanX = 0, leanY = 0
    const ptr = { x: 0, y: 0, inside: false }

    const render = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(render)
      const el = now - last
      // Capped rather than free-running: a drifting sky at a hundred and
      // sixty frames a second is a GPU bill for frames nobody can tell apart.
      if (el < (ecoRef.current ? ECO_MS : FRAME_MS)) return
      const dt = Math.min(0.05, el / 1000)
      last = now

      // Eased toward target; higher Damping settles faster.
      const k = 1 - Math.exp(-damping * 0.12 * dt)
      leanX += ((ptr.inside ? ptr.x : 0) - leanX) * k
      leanY += ((ptr.inside ? ptr.y : 0) - leanY) * k

      // The pointer's horizontal offset ADDS to the wind, so dragging one
      // way speeds the drift and the other way reverses it.
      const gust = 1 + leanX * wind
      const rate = speed * gust * DRIFT_SCALE
      nearX = (nearX - NEAR_DRIFT * rate * dt) % 1000
      farX = (farX - FAR_DRIFT * rate * dt) % 1000
      // Twinkle runs on Speed alone, never on the gust: the stars do not
      // feel the wind. Wrapped so the clock never loses float precision.
      twinkle = (twinkle + TWINKLE * speed * dt) % 6283.185

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const bw = Math.max(1, Math.round(window.innerWidth * dpr))
      const bh = Math.max(1, Math.round(window.innerHeight * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      gl.viewport(0, 0, bw, bh)

      gl.uniform2f(u('uRes'), bw, bh)
      gl.uniform1f(u('uNearX'), nearX)
      gl.uniform1f(u('uFarX'), farX)
      gl.uniform1f(u('uTime'), twinkle)
      gl.uniform1f(u('uCoverage'), coverage)
      gl.uniform1f(u('uSize'), size)
      gl.uniform1f(u('uSoftness'), softness)
      gl.uniform1f(u('uShadow'), shadow)
      gl.uniform1f(u('uStars'), starAmt)
      gl.uniform2f(u('uSun'), sunX, sunY)
      gl.uniform2f(u('uParallax'), -leanX * parallax * 0.07, -leanY * parallax * 0.05)
      gl.uniform3f(u('uZenith'), zen[0], zen[1], zen[2])
      gl.uniform3f(u('uHorizon'), hor[0], hor[1], hor[2])
      gl.uniform3f(u('uCloud'), cld[0], cld[1], cld[2])
      gl.uniform4f(u('uGlow'), glow[0], glow[1], glow[2], glow[3])

      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    /* The canvas takes no pointer events - it is a background - so the lean
       is read off the window instead of the element. */
    const track = (e: PointerEvent) => {
      const w = window.innerWidth, h = window.innerHeight
      if (w <= 0 || h <= 0) return
      ptr.x = (e.clientX / w) * 2 - 1
      ptr.y = 1 - (e.clientY / h) * 2
      ptr.inside = true
    }
    const onLeave = () => { ptr.inside = false }

    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(render) } }
    const halt = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onFocus = () => { if (pause.current) start() }
    const onBlur = () => { if (pause.current) halt() }

    if (!pause.current || document.hasFocus()) start()
    window.addEventListener('pointermove', track, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    // Never loseContext(): getContext returns the same context per canvas, so
    // StrictMode's mount -> cleanup -> mount would reuse a force-lost one.
    return () => {
      stopped = true
      halt()
      window.removeEventListener('pointermove', track)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return <canvas ref={cvRef} className="night-sky" aria-hidden />
}
