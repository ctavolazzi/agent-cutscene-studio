// The player's soundtrack: rendered in a worker so the picture keeps playing while it is made. The same code and seed
// as scripts/sound.js, so the player plays the same samples as the export. Posts { progress } as it goes, then
// { done, sr, left, right, stats } with the sample buffers transferred.
import { CONFIG } from '../config.js';
import { renderSoundtrack } from './index.js';

self.onmessage = () => {
  const r = renderSoundtrack(CONFIG, { onProgress: (u) => self.postMessage({ progress: u }) });
  self.postMessage({ done: true, sr: r.sr, left: r.left, right: r.right, stats: r.stats }, [r.left.buffer, r.right.buffer]);
};
