/* global document, Image, createImageBitmap */
// Embedded by snow-alpha-probe.py. No imports/network and no game/storage access.
export function compareRgb(points, pixels, tolerance = 2) {
  if (pixels.length !== points.length * 4) throw new Error('Incomplete readback');
  let mismatches = 0, zeroAlphaMismatches = 0, maxError = 0;
  const samples = points.map((p, i) => {
    const actual = Array.from(pixels.slice(i * 4, i * 4 + 4));
    const error = Math.max(...p.rgba.slice(0, 3).map((v, c) => Math.abs(v - actual[c])));
    if (error > tolerance) { mismatches++; if (p.rgba[3] === 0) zeroAlphaMismatches++; }
    maxError = Math.max(maxError, error);
    return { x: p.x, y: p.y, expected: p.rgba, actual, error };
  });
  return { mismatches, zeroAlphaMismatches, maxError, samples };
}

const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
const FRAGMENT = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uTex;uniform ivec2 uPixel;uniform int uLod,uSrgb,uMode;
out vec4 result;
vec3 toSrgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
void main(){vec4 t=texelFetch(uTex,uPixel,uLod);vec3 c=uSrgb==1?toSrgb(t.rgb):t.rgb;
result=uMode==1?vec4(vec3(t.a),1):vec4(c,uMode==2?t.a:1.0);}`;

function checked(gl, phase) {
  const errors = [];
  for (let i = 0; i < 8; i++) { const e = gl.getError(); if (!e) break; errors.push(e); }
  if (errors.length || gl.isContextLost()) throw new Error(`${phase}: GL ${errors.join(',')} lost=${gl.isContextLost()}`);
}

function programOf(gl) {
  const shaders = [];
  const program = gl.createProgram();
  try {
    for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  } catch (error) { gl.deleteProgram(program); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

function blobOf(variant) {
  const text = atob(variant.base64);
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  return new Blob([bytes], { type: variant.mime });
}

async function imageOf(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = 'async';
      const finish = (error) => {
        clearTimeout(timer); image.onload = image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve(image);
      };
      const timer = setTimeout(() => finish(new Error('Image decoding timed out')), 20000);
      image.onload = () => finish(null); image.onerror = () => finish(new Error('Image decoding failed'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function runProbe(payload, status) {
  const report = { format: payload.format, version: payload.version, time: new Date().toISOString(),
    userAgent: navigator.userAgent, sources: payload.variants.map(({ name, sha256 }) => ({ name, sha256 })), tests: [] };
  const canvas = document.createElement('canvas');
  canvas.width = payload.points.length; canvas.height = 1;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  let program;
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    report.context = { attributes: gl.getContextAttributes(), version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR),
      unmaskedRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    if (Math.max(payload.width, payload.height) > report.context.maxTextureSize) throw new Error('Atlas exceeds MAX_TEXTURE_SIZE');
    program = programOf(gl); gl.useProgram(program);
    const loc = Object.fromEntries(['uTex', 'uPixel', 'uLod', 'uSrgb', 'uMode'].map(k => [k, gl.getUniformLocation(program, k)]));
    gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.uniform1i(loc.uTex, 0);
    const read = (points, srgb, lod, mode) => {
      gl.uniform1i(loc.uSrgb, srgb ? 1 : 0); gl.uniform1i(loc.uLod, lod); gl.uniform1i(loc.uMode, mode);
      for (let i = 0; i < points.length; i++) {
        gl.viewport(i, 0, 1, 1); gl.uniform2i(loc.uPixel, points[i][0], points[i][1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const pixels = new Uint8Array(points.length * 4);
      gl.readPixels(0, 0, points.length, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      checked(gl, 'draw/readPixels'); return pixels;
    };
    const sample = (source, width, height, { srgb = true, storage = true, raw = false, flipped = false } = {}) => {
      const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !raw && !flipped);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        const levels = raw ? 1 : 1 + Math.floor(Math.log2(Math.max(width, height)));
        const internal = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, raw ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (raw) gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        else if (storage) {
          gl.texStorage2D(gl.TEXTURE_2D, levels, internal, width, height);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, source);
        checked(gl, 'upload'); if (!raw) gl.generateMipmap(gl.TEXTURE_2D); checked(gl, 'mipmap');
        const points = payload.points.map((p, i) => raw ? [i, 0] : [p.x, height - 1 - p.y]);
        const rgb = read(points, srgb, 0, 0);
        const alpha = read(points, srgb, 0, 1);
        const nativeAlphaRgb = read(points, srgb, 0, 2);
        const mips = [];
        if (!raw) for (const lod of [1, 2, 3]) if (lod < levels) mips.push({ lod,
          rgb: Array.from(read(points.map(([x, y]) => [x >> lod, y >> lod]), srgb, lod, 0)) });
        return { comparison: compareRgb(payload.points, rgb), sampledAlpha: payload.points.map((_, i) => alpha[i * 4]),
          nativeAlphaRgb: Array.from(nativeAlphaRgb), mipSamples: mips };
      } finally { gl.deleteTexture(texture); }
    };
    const attempt = async (name, task, positiveControl = false) => {
      status(`正在测试：${name}`);
      try { report.tests.push({ name, positiveControl, ...await task() }); }
      catch (e) { report.tests.push({ name, positiveControl, error: String(e) }); }
    };
    await attempt('raw-rgba-control', () => sample(new Uint8Array(payload.points.flatMap(p => p.rgba)), payload.points.length, 1, { raw: true }));
    for (const variant of payload.variants) {
      const blob = blobOf(variant);
      let image;
      try {
        image = await imageOf(blob);
        if (image.naturalWidth !== payload.width || image.naturalHeight !== payload.height) throw new Error('Unexpected image dimensions');
        await attempt(`${variant.name}/img-srgb-storage`, () => sample(image, payload.width, payload.height));
        if (variant.name !== 'original-lossy-rgba') continue;
        const fresh = async options => {
          const copy = await imageOf(blob);
          try { return sample(copy, payload.width, payload.height, options); } finally { copy.src = ''; }
        };
        await attempt('original/img-rgba8-storage', () => fresh({ srgb: false }));
        await attempt('original/img-srgb-texImage', () => fresh({ storage: false }));
        await attempt('original/img-srgb-storage-repeat', () => sample(image, payload.width, payload.height));
        await attempt('original/bitmap-none', async () => {
          const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
          try { return sample(bitmap, payload.width, payload.height, { flipped: true }); } finally { bitmap.close(); }
        });
        // Positive control: Canvas2D is allowed to lose hidden RGB. It is never a
        // decoder baseline and its failure does not establish the game's cause.
        await attempt('original/canvas2d-positive-control', () => {
          const c = document.createElement('canvas'); c.width = payload.width; c.height = payload.height;
          try { c.getContext('2d').drawImage(image, 0, 0); return sample(c, c.width, c.height); }
          finally { c.width = c.height = 0; }
        }, true);
      } catch (e) { report.tests.push({ name: variant.name, error: String(e) }); }
      finally { if (image) image.src = ''; }
    }
    report.caution = 'Canvas2D is a positive control only. LOD0 has offline pixel expectations; compare mip RGB with the fixed RGB reference, not LOD0. A passing probe does not explain a prior failing game frame.';
    return report;
  } finally {
    if (program) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width = canvas.height = 0;
  }
}

if (typeof document !== 'undefined' && document.getElementById('payload')) {
  const button = document.getElementById('run'), save = document.getElementById('save'), status = document.getElementById('status');
  let report;
  button.addEventListener('click', async () => {
    button.disabled = true; save.disabled = true;
    try {
      const payload = JSON.parse(document.getElementById('payload').textContent);
      report = await runProbe(payload, message => { status.textContent = message; });
      status.textContent = JSON.stringify(report, null, 2); save.disabled = false;
    } catch (e) { status.textContent = String(e); }
    finally { button.disabled = false; }
  });
  save.addEventListener('click', () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'snow-alpha-diagnostic.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
