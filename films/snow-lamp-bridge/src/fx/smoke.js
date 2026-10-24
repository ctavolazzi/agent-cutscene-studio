// The cigarette (look stage): the lighter's flame between A's cupped hands while it burns, the ember at the tip once it
// catches, and the smoke from smokePuffs(t), the wisp off the ember and the cloud A exhales. Flame and ember read the
// same timing as their lights (world.js lighterFlicker, emberLevel) and the same points on the rig (people.js cup and
// tip), so the drawn flame sits where the light is. Puffs are pooled sprites: a puff's look is a function of its age.
// Contract: src/CONTRACT.md
import { LIGHTER, emberLevel, emberOn, lighterFlicker, lighterOn, smokePuffs, EMBER } from '../world.js';
import { makePoser, bodyToWorld } from '../actors/people.js';

const POOL = 16; // smokePuffs never returns more than 15 (8 wisps, 7 exhaled puffs)

// a round falloff, white, the strength in alpha; `soft` raises the falloff's power for a thin edge
function roundBytes(n, power) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * (r >= 1 ? 0 : (1 - r) ** power));
    }
  }
  return d;
}

export function buildSmoke(ctx) {
  const { THREE, scene, config } = ctx;
  const C = config.smoke;
  const root = new THREE.Group();
  root.name = 'smoke';
  const tex = (power) => {
    const t = new THREE.DataTexture(roundBytes(32, power), 32, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const hot = tex(1.5), soft = tex(2.5);
  const sprite = (map, color, additive, name) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.name = name;
    s.visible = false;
    root.add(s);
    return s;
  };
  const flame = sprite(hot, new THREE.Color(C.flame.color), true, 'smoke-flame');
  const flameHalo = sprite(hot, new THREE.Color(C.flame.color), true, 'smoke-flame-halo');
  const ember = sprite(hot, new THREE.Color(C.ember.color), true, 'smoke-ember');
  const emberHalo = sprite(hot, new THREE.Color(C.ember.color), true, 'smoke-ember-halo');
  const puffs = Array.from({ length: POOL }, (_, i) => sprite(soft, new THREE.Color(C.puff.color), false, `smoke-puff-${i}`));
  // smoke draws before the snow (renderOrder 2), so a flake in front of a puff stays in front
  for (const p of puffs) p.renderOrder = 1;

  const poseA = makePoser('A');
  const peak = 1 + EMBER.dragGain;
  scene.add(root);
  return {
    root,
    update(t) {
      const a = poseA(t);
      const lit = lighterOn(t);
      flame.visible = flameHalo.visible = lit && a.visible !== false;
      if (flame.visible) {
        const f = lighterFlicker(t), at = bodyToWorld(a, a.cup);
        flame.position.set(at[0], at[1] + C.flame.lift, at[2]);
        flame.scale.set(C.flame.size * 0.6, C.flame.size * (0.8 + 0.4 * f), 1);
        flame.material.opacity = 0.7 + 0.3 * f;
        flameHalo.position.copy(flame.position);
        flameHalo.scale.setScalar(C.flame.halo * (0.85 + 0.3 * f));
        flameHalo.material.opacity = C.flame.haloOpacity * f;
      }
      const e = emberLevel(t);
      ember.visible = emberHalo.visible = emberOn(t) && e > 0;
      if (ember.visible) {
        const at = bodyToWorld(a, a.tip), k = e / peak;
        ember.position.set(at[0], at[1], at[2]);
        ember.scale.setScalar(C.ember.size * (0.7 + 0.3 * k));
        ember.material.opacity = 0.6 + 0.4 * k;
        emberHalo.position.copy(ember.position);
        emberHalo.scale.setScalar(C.ember.halo * (0.6 + 0.4 * k));
        emberHalo.material.opacity = C.ember.haloOpacity * k;
      }
      const list = t >= LIGHTER.t1 ? smokePuffs(t, bodyToWorld(a, a.tip)) : [];
      puffs.forEach((p, i) => {
        const q = list[i];
        p.visible = Boolean(q);
        if (!q) return;
        p.position.set(q.pos[0], q.pos[1], q.pos[2]);
        p.scale.setScalar(2 * q.r * C.puff.grow);
        p.material.opacity = q.alpha * C.puff.opacity;
      });
    },
  };
}
