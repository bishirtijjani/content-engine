// Manual captions for item-45 with hardcoded timing from transcript
import fs from 'node:fs';

const words = JSON.parse(fs.readFileSync('data/compositions/item-45/transcript.json', 'utf8'));

// Build word index for lookup by position
// Transcript: You(0) probably(1) think(2) your(3) business(4) is(5) automated.(6)
// Here's(7) how(8) to(9) find(10) out(11) in(12) 30(13) seconds.(14)
// There(15) are(16) three(17) levels(18) of(19) business(20) automation,(21)
// and(22) most(23) businesses(24) that(25) think(26) they're(27) at(28)
// level(29) 3(30) are(31) actually(32) stuck(33) at(34) level(35) 2.(36)
// Level(37) 1(38) is(39) manual.(40)
// A(41) person(42) has(43) to(44) start(45) the(46) process,(47)
// do(48) the(49) work,(50) and(51) make(52) sure(53) it(54) gets(55) finished.(56)
// If(57) that(58) person(59) disappears(60) for(61) a(62) week,(63)
// the(64) process(65) stops.(66)
// Level(67) 2(68) is(69) semi-automated.(70)
// This(71) is(72) where(73) most(74) businesses(75) get(76) stuck.(77)
// You've(78) got(79) software(80) sending(81) emails,(82) moving(83) data,(84)
// taking(85) payments,(86) maybe(87) even(88) using(89) AI.(90)
// But(91) someone(92) still(93) has(94) to(95) keep(96) the(97) process(98) moving.(99)
// For(100) example,(101) a(102) lead(103) fills(104) out(105) your(106) form.(107)
// Your(108) CRM(109) captures(110) them,(111) and(112) an(113) automated(114)
// email(115) goes(116) out.(117)
// Sounds(118) automated,(119) right?(120)
// But(121) then(122) someone(123) still(124) has(125) to(126) remember(127)
// to(128) follow(129) up,(130) qualify(131) the(132) lead,(133)
// book(134) the(135) appointment,(136) and(137) update(138) the(139) CRM.(140)
// That's(141) level(142) 2.(143)
// The(144) system(145) is(146) doing(147) the(148) busy(149) work,(150)
// but(151) a(152) human(153) is(154) still(155) closing(156) the(157) loop.(158)
// And(159) buying(160) more(161) software.(162)

function w(i) { return { start: words[i].start, end: words[i].end }; }
function span(a, b) { return { start: w(a).start, end: w(b).end }; }

// [text, emphasisWord or null, wordIndexStart, wordIndexEnd]
const defs = [
  // Scene 1: Hook (0-9s)
  ["You probably think", null, 0, 2],
  ["your business is automated.", "automated", 3, 6],
  ["Here's how to", null, 7, 9],
  ["find out in 30 seconds.", "30 seconds", 10, 14],
  // Scene 2: Three Levels (9-19s)
  ["There are three levels of", null, 15, 19],
  ["business automation,", "business automation", 20, 21],
  ["and most businesses that", null, 22, 25],
  ["think they're at", null, 26, 28],
  ["level 3", "level 3", 29, 30],
  ["are actually stuck", null, 31, 33],
  ["at level 2.", "level 2", 34, 36],
  // Scene 3: Level 1 (19-27s)
  ["Level 1", "level 1", 37, 38],
  ["is manual.", null, 39, 40],
  ["A person has", null, 41, 43],
  ["to start the process,", "process", 44, 47],
  ["do the work,", null, 48, 50],
  ["and make sure", null, 51, 53],
  ["it gets finished.", null, 54, 56],
  ["If that person disappears", null, 57, 60],
  ["for a week,", null, 61, 63],
  ["the process stops.", "stops", 64, 66],
  // Scene 4: Level 2 (27-39s)
  ["Level 2", "level 2", 67, 68],
  ["is semi-automated.", null, 69, 70],
  ["This is where", null, 71, 73],
  ["most businesses", null, 74, 75],
  ["get stuck.", null, 76, 77],
  ["You've got software", null, 78, 80],
  ["sending emails, moving data,", null, 81, 84],
  ["taking payments,", null, 85, 86],
  ["maybe even using AI.", null, 87, 90],
  ["But someone still has", null, 91, 94],
  ["to keep the process moving.", "process moving", 95, 99],
  // Scene 5: Example (39-47s)
  ["For example,", null, 100, 101],
  ["a lead fills out", null, 102, 105],
  ["your form.", null, 106, 107],
  ["Your CRM captures them,", "CRM", 108, 111],
  ["and an automated email", null, 112, 115],
  ["goes out.", null, 116, 117],
  ["Sounds automated,", "automated", 118, 119],
  ["right?", null, 120, 120],
  // Scene 6: Still manual (47-57s)
  ["But then someone still has", null, 121, 125],
  ["to remember to follow up,", null, 126, 130],
  ["qualify the lead,", null, 131, 133],
  ["book the appointment,", null, 134, 136],
  ["and update the CRM.", "CRM", 137, 140],
  ["That's level 2.", "level 2", 141, 143],
  // Scene 7: Closing (57-63s)
  ["The system is doing", null, 144, 147],
  ["the busy work,", null, 148, 150],
  ["but a human is still", null, 151, 155],
  ["closing the loop.", null, 156, 158],
  ["And buying more software.", "more software", 159, 162],
];

const LEAD = '#0f4c81';
const SECOND = '#EA580C';
const hold = 0.15;
let emphCount = 0;

const lines = defs.map((d, i) => {
  const [text, emph, wi, wj] = d;
  const segs = [];
  if (emph) {
    const idx = text.toLowerCase().indexOf(emph.toLowerCase());
    if (idx > 0) segs.push({ type: 'plain', text: text.slice(0, idx).replace(/[,\s]+$/, '').trim() });
    segs.push({ type: 'emph', text: emph, color: emphCount++ % 2 === 0 ? LEAD : SECOND });
    const after = text.slice(idx + emph.length).replace(/^[,\s]+/, '').trim();
    if (after) segs.push({ type: 'plain', text: after });
  } else {
    segs.push({ type: 'plain', text: text.replace(/[,\s]+$/, '').trim() });
  }

  const timing = span(wi, wj);
  return { segs, start: timing.start, end: timing.end };
});

// Apply timing with hold and min duration
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  let end = Math.max(L.end, L.start + 0.6) + hold;
  if (i + 1 < lines.length) {
    end = Math.min(end, lines[i + 1].start);
  }
  L.start = Math.round(L.start * 1000) / 1000;
  L.end = Math.round(end * 1000) / 1000;
  L.dur = Math.round(Math.max(0.1, L.end - L.start) * 1000) / 1000;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = lines.map((L, i) => {
  const inner = L.segs
    .map(s => s.type === 'emph'
      ? `<span class="e" style="color:${s.color}">${esc(s.text)}</span>`
      : `<span class="l">${esc(s.text)}</span>`)
    .join('');
  return `<div id="c${i + 1}" class="cap" data-start="${L.start}" data-duration="${L.dur}" data-track-index="${5 + (i % 2)}"><div class="cap-inner">${inner}</div></div>`;
}).join('\n  ');

fs.writeFileSync('data/compositions/item-45/master/captions.html', html);

// Print summary
lines.forEach((L, i) => {
  const text = L.segs.map(s => s.text).join(' ');
  const wordCount = text.replace(/[.,;:!?]/g, '').split(/\s+/).filter(Boolean).length;
  const charCount = text.length;
  const emph = L.segs.some(s => s.type === 'emph');
  const warn = wordCount > 5 || charCount > 30 ? ' ⚠️' : '';
  console.log(`c${i + 1}: ${L.start}-${L.end} track=${5 + (i % 2)} w=${wordCount} c=${charCount} emph=${emph}${warn} "${text}"`);
});
console.log(`\nTotal: ${lines.length} captions`);
