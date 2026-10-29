import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createSnakePlayer} from '../snake.js';

class Target extends EventTarget {
  listeners = 0;
  addEventListener(...args) { this.listeners++; super.addEventListener(...args); }
}

function fixture({reduced = false, hidden = false, media = true, legacy = false} = {}) {
  let now = 0, serial = 0, prompt = true;
  const timers = new Map();
  const changes = [];
  const view = new Target();
  const document = new Target();
  const motion = new Target();
  document.hidden = hidden;
  motion.matches = reduced;
  if (legacy) {
    motion.addEventListener = undefined;
    motion.addListener = callback => {
      motion.listeners++;
      EventTarget.prototype.addEventListener.call(motion, 'change', callback);
    };
  }
  Object.assign(view, {
    document,
    performance: {now: () => now},
    setTimeout(callback, delay) {
      assert.ok(delay > 0, 'Only schedule a future frame boundary.');
      timers.set(++serial, {at: now + delay, callback});
      assert.equal(timers.size, 1, 'At most one timeout may be pending.');
      return serial;
    },
    clearTimeout: id => timers.delete(id),
  });
  if (media) view.matchMedia = query => {
    assert.equal(query, '(prefers-reduced-motion: reduce)');
    return motion;
  };
  const player = createSnakePlayer(view, visible => {
    changes.push({at: now, visible});
    prompt = visible;
  });
  return {
    player, view, document, motion, timers, changes,
    get prompt() { return prompt; },
    get listeners() { return view.listeners + document.listeners + motion.listeners; },
    at(time) {
      assert.ok(time >= now);
      now = time;
      // Delayed callbacks observe the current time, not their original deadline.
      let due = [...timers].find(([, timer]) => timer.at <= now);
      while (due) {
        const [id, timer] = due;
        timers.delete(id);
        timer.callback();
        due = [...timers].find(([, timer]) => timer.at <= now);
      }
    },
    reduce(value) { motion.matches = value; motion.dispatchEvent(new Event('change')); },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

function target() {
  let text = '', writes = 0;
  return {
    isConnected: true,
    get textContent() { return text; },
    set textContent(value) { text = value; writes++; },
    get writes() { return writes; },
  };
}

const starts = [0, 240, 560, 640, 740, 820, 1040, 1240, 1360, 1520, 1600, 1680, 1800, 1880, 1960, 2040, 2200, 2280, 2560];
const mouths = ['       ', '       ', '-<     ', '--<    ', '-<     ', '       ', '       ', '       ', '       ', '-<     ', '--<    ', '---<   ', '---<   ', '--<    ', '-<     ', '       ', '       ', '       ', '       '];

function recordSequence() {
  const env = fixture();
  const node = target();
  env.player.play(node);
  const frames = starts.map((startMs, index) => {
    env.at(startMs);
    return {startMs, durationMs: (starts[index + 1] ?? 2960) - startMs, text: node.textContent, showPrompt: env.prompt};
  });
  return {env, node, frames};
}

test('playback matches the supplied sequence with only the cursor prop removed', () => {
  // Independent golden values from python_frames.json, version 1, replacing
  // only the prop underscore at row 3, column 32 with a space. The digest
  // covers every padded character, original timing and prompt state.
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(JSON.stringify(recordSequence().frames)),
    'eb8b49c7b20402b8fd8408a7d2ab53fdaa5c9199dbe76378482781fe2faa984f');
  const env = fixture({reduced: true});
  const node = target();
  env.player.play(node);
  assert.equal(hash(node.textContent),
    '4fb617f7288b92c8fef93c24ab4d343a84f4f559599f8a10e6f979d186da6716');
});

test('all 19 reference frames preserve the grid, coil and timing without a cursor prop', () => {
  const {env, node, frames} = recordSequence();
  const fixed = frames[0].text.split('\n');
  for (const [index, frame] of frames.entries()) {
    const rows = frame.text.split('\n');
    assert.equal(rows.length, 12);
    assert.ok(rows.every(row => row.length === 34));
    assert.doesNotMatch(frame.text, /[^\x20-\x7e\n]/);
    for (let row = 0; row < rows.length; row++) {
      if (row !== 1 && row !== 2) assert.equal(rows[row], fixed[row]);
    }
    assert.equal(rows[1].slice(0, 21), fixed[1].slice(0, 21));
    assert.equal(rows[1].slice(22), fixed[1].slice(22));
    assert.equal(rows[1][21], index === 0 || index === 16 ? '-' : 'o');
    assert.equal(rows[2].slice(0, 27), fixed[2].slice(0, 27));
    assert.equal(rows[2].slice(27), mouths[index]);
    assert.doesNotMatch(rows[2].slice(27), /_/);
    assert.equal(frame.showPrompt, index === 18);
  }
  assert.deepEqual(env.changes, [{at: 0, visible: false}, {at: 2560, visible: true}]);
  const finalText = node.textContent;
  env.at(2960);
  assert.equal(env.timers.size, 0);
  assert.equal(node.textContent, finalText);
  const writes = node.writes;
  env.at(60000);
  assert.equal(node.writes, writes, 'Playback never loops.');
});

test('finish is immediate, idempotent and clears all pending work', () => {
  const env = fixture();
  const node = target();
  env.player.play(node);
  env.at(1600);
  assert.equal(node.textContent.split('\n')[2].slice(27), '--<    ');
  env.player.finish();
  assert.equal(node.textContent.split('\n')[2].slice(27), '       ');
  assert.equal(env.prompt, true);
  assert.equal(env.timers.size, 0);
  const writes = node.writes, changes = env.changes.length;
  env.player.finish(); env.at(10000);
  assert.equal(node.writes, writes);
  assert.equal(env.changes.length, changes);
});

test('reduced motion, missing media-query support and background startup show a still with no timer', () => {
  for (const options of [{reduced: true}, {media: false}, {hidden: true}]) {
    const env = fixture(options);
    const node = target();
    env.player.play(node);
    assert.equal(node.textContent.split('\n')[1][21], 'o');
    assert.equal(node.textContent.split('\n')[2].slice(27), '--<    ');
    assert.equal(env.prompt, true);
    assert.equal(env.timers.size, 0);
    assert.deepEqual(env.changes, []);
  }
});

test('enabling reduced motion during playback settles immediately and never resumes automatically', () => {
  for (const legacy of [false, true]) {
    const env = fixture({legacy});
    const node = target();
    env.player.play(node); env.at(640);
    env.reduce(true);
    assert.equal(node.textContent.split('\n')[2].slice(27), '--<    ');
    assert.equal(env.prompt, true);
    assert.equal(env.timers.size, 0);
    const writes = node.writes;
    env.reduce(false); env.at(5000);
    assert.equal(node.writes, writes);
  }
});

test('hidden pages, page exit and removed output stop playback', () => {
  for (const action of ['hide', 'pagehide', 'detach']) {
    const env = fixture();
    const node = target();
    env.player.play(node);
    if (action === 'hide') env.hide(true);
    else if (action === 'pagehide') env.view.dispatchEvent(new Event('pagehide'));
    else { node.isConnected = false; env.at(240); }
    assert.equal(env.prompt, true);
    assert.equal(env.timers.size, 0);
    const writes = node.writes;
    env.hide(false); env.at(10000);
    assert.equal(node.writes, writes);
  }
});

test('delayed timers skip expired frames and retain the original end time', () => {
  const env = fixture();
  const node = target();
  env.player.play(node);
  env.at(1700);
  assert.equal(node.textContent.split('\n')[2].slice(27), '---<   ');
  assert.equal([...env.timers.values()][0].at, 1880, 'Skip the now-identical contact hold');
  env.at(2600);
  assert.equal(env.prompt, true);
  assert.equal([...env.timers.values()][0].at, 2960);
  env.at(5000);
  assert.equal(env.timers.size, 0);
  assert.ok(node.writes <= 3, 'Do not repaint every missed frame.');
});

test('new invocations settle previous output and retain only one timer without growing listeners', () => {
  const env = fixture();
  const listeners = env.listeners;
  const previous = target();
  env.player.play(previous); env.at(1040);
  for (let index = 0; index < 60; index++) env.player.play(target());
  assert.equal(previous.textContent.split('\n')[2].slice(27), '       ');
  const writes = previous.writes;
  assert.equal(env.timers.size, 1);
  assert.equal(env.listeners, listeners);
  env.player.finish(); env.at(10000);
  assert.equal(env.timers.size, 0);
  assert.equal(previous.writes, writes);
});
