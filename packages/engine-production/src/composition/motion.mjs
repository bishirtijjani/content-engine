// composition/motion.mjs — a beat's action, as GSAP timeline lines.
//
// A beat names an `action.op` and the slot(s) it acts on. This module turns that
// into GSAP tween lines against the slot's selector inside its scene. It owns no
// timing of its own: every number comes from config/style.json → composition.motion
// (with the root `motion` block as the fallback), so a video's feel is locked in
// one place.
//
// Number figures count up: an introduce/reveal of a slot that holds a `.cx-num`
// with `data-count-to` animates from 0 to the exact stated value. The final frame
// is always the exact value.
import { targetList } from './snapshot-spec.mjs';
import { resolveCueTime, slotValue, cueFor } from './sync.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;

/** Resolve the composition motion vocabulary from the locked style. */
export function motionCfg(style) {
  const m = style?.composition?.motion ?? {};
  const root = style?.motion ?? {};
  return {
    ease: m.ease ?? root.ease ?? 'power2.out',
    in: m.in ?? root.cardIn ?? root.in ?? 0.5,
    rise: m.rise ?? 40,
    stagger: m.stagger ?? 0.1,
    highlight: { scale: m.highlight?.scale ?? 1.06, duration: m.highlight?.duration ?? 0.5 },
    countUp: m.countUp ?? 0.9,
  };
}

/**
 * The GSAP lines a beat contributes.
 * @returns {{ lines: string[], counts: Array<{sel:string, at:number, dur:number}> }}
 */
export function beatLines(beat, { sceneSel, style, segment = null, words = null }) {
  const cfg = motionCfg(style);
  const op = beat?.action?.op ?? 'introduce';
  if (op === 'hold') return { lines: [], counts: [] };

  const slots = targetList(beat?.action?.target);
  const at = r3(beat.start);
  // A cue resolves inside the BEAT that declares it (with a hair of tolerance),
  // never somewhere else in the segment — so a slot can only appear while its own
  // narration is being spoken, not drift into a neighbouring beat.
  const win = { min: at - 0.2, max: r3(beat.end) + 0.2 };
  const lines = [];
  const counts = [];

  slots.forEach((slot, i) => {
    const sel = `${sceneSel} [data-slot='${slot}']`;
    // Land the reveal on the exact narration word: an explicit cue wins, then a
    // figure's own number, then the beat's start (+ stagger).
    let t = null;
    if (words) {
      const cue = cueFor(beat, slot) ?? slotValue(segment, slot);
      if (cue) {
        const hit = resolveCueTime(cue, words, win);
        if (hit != null) t = r3(hit);
      }
    }
    if (t == null) t = r3(at + i * cfg.stagger);
    // The scene only exists from its start — a lead-in reveal rides the scene start.
    if (segment && t < segment.start) t = r3(segment.start);
    if (op === 'introduce' || op === 'reveal') {
      lines.push(`tl.set("${sel}", {opacity:0, y:${cfg.rise}}, ${at});`);
      lines.push(`tl.to("${sel}", {opacity:1, y:0, duration:${cfg.in}, ease:"${cfg.ease}"}, ${t});`);
      counts.push({ sel, at: t, dur: cfg.countUp });
    } else if (op === 'move') {
      lines.push(`tl.fromTo("${sel}", {y:${cfg.rise}}, {y:0, duration:${cfg.in}, ease:"${cfg.ease}"}, ${t});`);
    } else if (op === 'resize') {
      lines.push(`tl.fromTo("${sel}", {scale:0.92}, {scale:1, duration:${cfg.in}, ease:"${cfg.ease}"}, ${t});`);
    } else if (op === 'highlight') {
      const h = cfg.highlight;
      lines.push(`tl.fromTo("${sel}", {scale:1}, {scale:${h.scale}, duration:${r3(h.duration / 2)}, ease:"power2.out"}, ${at});`);
      lines.push(`tl.to("${sel}", {scale:1, duration:${r3(h.duration / 2)}, ease:"power2.inOut"}, ${r3(at + h.duration / 2)});`);
    } else {
      // restyle / retext / replace: a clean swap
      lines.push(`tl.fromTo("${sel}", {opacity:0}, {opacity:1, duration:${cfg.in}, ease:"${cfg.ease}"}, ${t});`);
    }
  });

  return { lines, counts };
}

/**
 * The scene entrance/exit lines. Every slot is hidden at the scene start — the
 * scene shows its backdrop with nothing on it — and the beats reveal the slots,
 * so nothing is on screen before its narration. The scene fades out at its end.
 */
export function sceneLines(segment, { sceneSel, style, fadeOut = true }) {
  const cfg = motionCfg(style);
  const transp = segment?.transitionOut ?? {};
  const tech = transp.technique ?? 'crossfade';
  const start = r3(segment?.start ?? 0);
  const end = r3(segment?.end ?? 0);
  const lines = [];

  // Hide every slot at the scene start; beats reveal them on their words.
  lines.push(`tl.set("${sceneSel} [data-slot]", {opacity:0, y:${cfg.rise}}, ${start});`);

  // Fade only when footage (or the end) follows — between two b-rolls the next
  // scene takes over on the same backdrop, so there is nothing to fade.
  if (fadeOut && tech !== 'none') {
    const d = transp.duration ?? cfg.in;
    lines.push(`tl.to("${sceneSel}", {opacity:0, duration:${r3(d)}, ease:"${cfg.ease}"}, ${r3(Math.max(start, end - d))});`);
  }
  return lines;
}

/** The one-time helper the timeline needs for count-up figures. */
export function countUpHelper() {
  return `      function __fmt(n, fmt){
        const g = Math.round(n).toLocaleString('en-US');
        if (fmt === 'currency') return '$' + g;
        if (fmt === 'percent') return g + '%';
        if (fmt === 'decimal') return String(Math.round(n * 10) / 10);
        return g;
      }
      function __countUp(root, at, dur){
        const el = document.querySelector(root + ' .cx-num');
        if (!el || !el.dataset || el.dataset.countTo === undefined) return;
        const to = Number(el.dataset.countTo);
        const fmt = el.dataset.countFormat || 'int';
        if (!Number.isFinite(to)) return;
        const o = { v: 0 };
        el.textContent = __fmt(0, fmt);
        tl.to(o, { v: to, duration: dur, ease: 'power2.out', onUpdate: function(){ el.textContent = __fmt(o.v, fmt); } }, at);
        tl.set(el, {}, at + dur);
      }`;
}
