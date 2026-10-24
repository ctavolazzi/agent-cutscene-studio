// The final pass: the scene renders into a half-float target at the internal resolution, then one full-screen pass
// writes the canvas: the fade from black (in linear light), linear to sRGB, then each channel cut to `bits` bits with a
// 4x4 Bayer dither. The canvas stays at config.res; the 4x (or 6x) nearest-neighbour upscale happens at display and in
// the capture, from config.out / config.res, so nothing here depends on the output size.
// The dither pattern is fixed to the pixel grid, so a still frame never shimmers and the same t gives the same pixels.

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform float uFade;
uniform float uLevels; // 2^bits - 1
uniform float uDither; // 1 on, 0 off
in vec2 vUv;
out vec4 outColor;
// 4x4 Bayer matrix, thresholds (i + 0.5) / 16
float bayer( vec2 p ) {
  int x = int( mod( p.x, 4.0 ) ), y = int( mod( p.y, 4.0 ) );
  int m[16] = int[16]( 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 );
  return ( float( m[ y * 4 + x ] ) + 0.5 ) / 16.0;
}
vec3 toSRGB( vec3 c ) {
  c = clamp( c, 0.0, 1.0 );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
void main() {
  vec3 c = toSRGB( texture( tScene, vUv ).rgb * uFade );
  float d = uDither > 0.5 ? bayer( gl_FragCoord.xy ) : 0.5;
  c = floor( c * uLevels + d ) / uLevels;
  outColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}`;

export function createPost(THREE, renderer, config) {
  const { w: W, h: H } = config.res;
  const target = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true,
  });
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tScene: { value: target.texture },
      uFade: { value: 1 },
      uLevels: { value: 2 ** config.ps1.bits - 1 },
      uDither: { value: config.ps1.dither ? 1 : 0 },
    },
    vertexShader: `in vec3 position;\nin vec2 uv;\n${VERTEX}`,
    fragmentShader: FRAGMENT,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    target,
    compile() { renderer.compile(scene, camera); },
    // draw `world` through `cam` into the target, then the pass onto the canvas
    render(world, cam, fade) {
      renderer.setRenderTarget(target);
      renderer.render(world, cam);
      renderer.setRenderTarget(null);
      material.uniforms.uFade.value = fade;
      renderer.render(scene, camera);
    },
  };
}
