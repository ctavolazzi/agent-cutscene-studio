// The PS1 material patch: every Lambert and Basic mesh material gets two things the PlayStation did by accident.
// Vertex snap: after projection, each vertex lands on the internal pixel grid (strength 0 to 1), so edges step and
// shimmer as the camera moves. Affine UV warp: texture coordinates interpolate across the screen, not in perspective
// (strength 0 to 1), so textures bend on large polygons. One shared uniform object drives every patched material.
// See src/CONTRACT.md: this only changes shaders, never geometry, so the frame is still a pure function of t.

// out = mix(perspective, affine, warp). The affine value is uv * w and w interpolated as usual, divided per fragment:
// that cancels the perspective divide, which is the screen-space interpolation the PS1 did.
const VERTEX_SNAP = /* glsl */ `
#include <project_vertex>
#ifdef USE_MAP
  vPs1MapUvw = vec3( vMapUv * gl_Position.w, gl_Position.w );
#endif
if ( gl_Position.w > 0.0 ) {
  vec2 ps1Grid = uPs1Res * 0.5;
  vec2 ps1Snapped = floor( gl_Position.xy / gl_Position.w * ps1Grid + 0.5 ) / ps1Grid;
  gl_Position.xy = mix( gl_Position.xy, ps1Snapped * gl_Position.w, uPs1Snap );
}`;

const DECLARE_VERTEX = /* glsl */ `
uniform vec2 uPs1Res;
uniform float uPs1Snap;
#ifdef USE_MAP
  varying vec3 vPs1MapUvw;
#endif
`;
const DECLARE_FRAGMENT = /* glsl */ `
uniform float uPs1Warp;
#ifdef USE_MAP
  varying vec3 vPs1MapUvw;
#endif
`;

// Shared by every patched material, so one write moves all of them.
export function createPs1Uniforms(THREE, config) {
  return {
    uPs1Res: { value: new THREE.Vector2(config.res.w, config.res.h) },
    uPs1Snap: { value: config.ps1.snap },
    uPs1Warp: { value: config.ps1.warp },
  };
}

// Patch one material. Keeps any onBeforeCompile and cache key it already had.
export function patchPs1(THREE, material, uniforms) {
  if (material.userData.ps1) return material;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (before) before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = DECLARE_VERTEX + shader.vertexShader.replace('#include <project_vertex>', VERTEX_SNAP);
    const mapFragment = THREE.ShaderChunk.map_fragment.replace(/vMapUv/g, 'ps1MapUv');
    shader.fragmentShader = DECLARE_FRAGMENT + shader.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec2 ps1MapUv = mix( vMapUv, vPs1MapUvw.xy / vPs1MapUvw.z, uPs1Warp );
#endif
${mapFragment}`);
  };
  material.customProgramCacheKey = () => `ps1|${key ? key.call(material) : ''}`;
  material.userData.ps1 = true;
  material.needsUpdate = true;
  return material;
}

// Patch every Lambert and Basic mesh material under `root` (points, lines and shader materials keep their own shaders).
export function patchScene(THREE, root, uniforms) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if ((m.isMeshLambertMaterial || m.isMeshBasicMaterial) && !m.userData.ps1) { patchPs1(THREE, m, uniforms); n++; }
    }
  });
  return n;
}
