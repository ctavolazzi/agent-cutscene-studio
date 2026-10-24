// Drawn after the scene, in the same frame: the fade from black, and the debug overlay
// (shot number, time, lens). Both are burned into the pixels so captures and stills show them.
import { tcode } from './shots.js';

export function createHud(THREE, config, { overlay }) {
  const W = config.res.w, H = config.res.h;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -1, 1);

  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(W, H), fadeMat);
  fade.position.set(W / 2, H / 2, 0);
  scene.add(fade);

  // overlay strip at the top: a canvas at the internal resolution, sampled nearest so the text stays crisp
  const stripH = 11;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = stripH;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(W, stripH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  strip.position.set(W / 2, H - stripH / 2, 0);
  strip.visible = overlay;
  scene.add(strip);

  let lastText = '';
  function label(t, shot) {
    const secs = (t % 60).toFixed(2).padStart(5, '0');
    return `S${String(shot.n).padStart(2, '0')}  ${Math.floor(t / 60)}:${secs}  ${shot.lens}mm  ${shot.title}  [${tcode(shot.start)}-${tcode(shot.end)}]`.replace('-', ' to ');
  }

  return {
    get overlay() { return overlay; },
    // the playback UI's debug toggle; captures set the overlay once, at load
    setOverlay(on) { overlay = Boolean(on); strip.visible = overlay; lastText = ''; },
    draw(renderer, { t, shot, fade: f }) {
      fadeMat.opacity = 1 - f;
      if (overlay) {
        const text = label(t, shot);
        if (text !== lastText) { // caching only skips redundant redraws; the pixels depend on t alone
          lastText = text;
          g.clearRect(0, 0, W, stripH);
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.fillRect(0, 0, W, stripH);
          g.fillStyle = '#ffd36b';
          g.font = '9px monospace';
          g.textBaseline = 'top';
          g.fillText(text, 3, 1);
          tex.needsUpdate = true;
        }
      }
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = auto;
    },
  };
}
