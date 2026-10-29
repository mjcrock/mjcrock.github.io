// 34 × 12 artwork from python_frames.json, with the prop cursor removed.
// The coil is shared; only the eye and the seven cells beside the snout change.
const coil = String.raw`                    ____
               ____/ o  \_
              /    .______)
             /    /
       _____/    /____
    .-'     \    \    '-.
   /   .-----\    \---.  \
   \   '------'    /  /  /
 .--'-.          /.-' .-'--.
(  <>  '--------'----'  <>  )
 '-.____________________.-'--._
                    '--------->`.split('\n').map(line => line.padEnd(34));
const mouths = ['       ', '-<     ', '--<    ', '---<   '];
// End time, eye, mouth. Identical holds are combined; the final cue returns the prompt.
const cues = [
  [240, '-', 0], [560, 'o', 0], [640, 'o', 1], [740, 'o', 2],
  [820, 'o', 1], [1520, 'o', 0], [1600, 'o', 1], [1680, 'o', 2],
  [1880, 'o', 3], [1960, 'o', 2], [2040, 'o', 1], [2200, 'o', 0],
  [2280, '-', 0], [2560, 'o', 0], [2960, 'o', 0],
];

function pose(eye, mouth) {
  const lines = coil.slice();
  lines[1] = lines[1].slice(0, 21) + eye + lines[1].slice(22);
  lines[2] = lines[2].slice(0, 27) + mouths[mouth];
  return lines.join('\n');
}
const rest = pose('o', 0);
const still = pose('o', 2);

export function createSnakePlayer(view, showPrompt) {
  const motion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  let node, timer, started, index;
  let promptVisible = true;
  const prompt = visible => {
    if (visible !== promptVisible) showPrompt(promptVisible = visible);
  };
  const settle = text => {
    if (!node) return;
    view.clearTimeout(timer);
    if (node.textContent !== text) node.textContent = text;
    node = null;
    prompt(true);
  };
  const finish = () => settle(rest);
  const tick = () => {
    if (!node) return;
    if (!node.isConnected || view.document.hidden) return finish();
    if (motion.matches) return settle(still);
    const elapsed = view.performance.now() - started;
    while (index < cues.length && elapsed >= cues[index][0]) index++;
    if (index === cues.length) return finish();
    const [end, eye, mouth] = cues[index];
    const text = pose(eye, mouth);
    if (node.textContent !== text) node.textContent = text;
    prompt(index === cues.length - 1);
    timer = view.setTimeout(tick, end - elapsed);
  };
  const reduce = () => { if (motion.matches) settle(still); };
  if (motion?.addEventListener) motion.addEventListener('change', reduce);
  else motion?.addListener?.(reduce);
  view.document.addEventListener('visibilitychange', () => { if (view.document.hidden) finish(); });
  view.addEventListener('pagehide', finish);
  return {
    play(target) {
      finish();
      node = target;
      if (!motion || motion.matches || view.document.hidden) return settle(still);
      index = 0;
      started = view.performance.now();
      tick();
    },
    finish,
  };
}
