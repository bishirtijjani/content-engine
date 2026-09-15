---
name: visual-layer
description: The visual-layer doctrine for generated compositions that carry captions — how to place a diagram, chart, or graphic layer (e.g. a Mermaid SVG) on a branded canvas so it fills the frame, never renders as a small thumbnail, never distorts, never sits in a white box, never collides with the caption band, and never breaks deterministic rendering. Load when building or editing a composition that layers a diagram/visual behind or above captions, when a diagram renders too small or inside a white panel, when an SVG is stretched or distorted, when a visual reaches into the caption area, or when a heavy full-frame visual causes render timeouts. The caption band rule here is the generated-composition counterpart to the footage-overlay doctrine in captions-overlay: captions-overlay governs captions composited over live footage (no reserved band); this skill governs generated visual-layer compositions where the caption band is a fixed reserved zone at top:72%.
---

# Visual-Layer Doctrine (generated compositions with captions)

> **Scope.** This doctrine governs **generated visual-layer compositions** — a branded canvas (e.g. the orange `#EA580C` gradient) with a diagram/chart/graphic layer and a caption line. It is the counterpart to `captions-overlay`, which governs captions composited over **live footage**. The two are different composition types with different rules. Do not apply one doctrine's rules to the other's scenario.

## The six non-negotiable rules

These are hard rules. Violating any of them is a defect. They were learned from a real build (item-45, the "three levels of business automation" Mermaid experiment) where each one was violated at least once.

### 1. The composition background is the canvas — visuals sit directly on it

The composition's background (e.g. `#EA580C` orange) **is** the canvas. A diagram or visual layer sits **directly on it**, full-bleed. There is **no white box, no panel, no card, no "thumbnail in a frame"** around a visual.

- Do not wrap a diagram in a `.diagram-panel`, `.card`, or any element with a background/border/padding that visually frames it.
- The diagram IS the hero. It fills the frame. The background shows only where the diagram does not cover it.
- A white box around a diagram on a colored canvas is the classic defect — it reads as a pasted thumbnail, not a designed composition.

### 2. A diagram must fill the frame, not render at its intrinsic tiny size

Mermaid (and similar generators) emit SVGs at a small intrinsic size with a **baked-in inline `style="max-width: <num>px"`** that caps the diagram at thumbnail dimensions (e.g. ~155px). This cap must be **overridden** or the diagram renders as a small thumbnail on the canvas.

- Override the baked-in cap: `max-width: none !important` on the SVG (or strip the inline `max-width` from the SVG markup).
- The diagram must scale up to fill its container, not sit at its intrinsic size.

### 3. Scale must preserve aspect ratio — never stretch to fill both dimensions independently

An SVG must scale **uniformly**. Setting both `width: 100%` and `height: 100%` stretches the diagram to fill both dimensions independently and **distorts** it (squashed or stretched shapes, wrong proportions).

- Correct pattern: `height: 100%; width: auto; margin: 0 auto;` inside a flex container that centers it. This fills the available height while preserving aspect ratio.
- Never use `width: 100%; height: 100%` on an SVG that must keep its shape.

### 4. Visuals must never reach the caption band

In a generated composition with captions, the captions sit at a **fixed reserved zone**: `top: 72%` (the bottom ~28% of the frame). The visual layer lives in the **top 72%** and must **never** extend down into the caption band — no matter what.

- The caption band is a hard keep-out zone for visuals. A diagram that reaches into it collides with the caption text and is a defect.
- Size the visual for the top 72% of the frame, not the full frame.
- This is the generated-composition counterpart to the `captions-overlay` doctrine: there, captions ride as an overlay over footage with no reserved band; here, the caption band is a fixed reserved zone and visuals must stay above it. The two rules do not conflict because they govern different composition types.

### 5. Heavy full-frame visuals can blow the renderer's page-load timeout

The renderer has a **10-second navigation timeout**. Heavy full-frame SVGs (large diagrams, many nodes) can exceed it — the render fails intermittently with "Navigation timeout of 10000 ms exceeded". Retries often succeed, but the failure is a signal.

- Cap diagram height to roughly **60% of the frame** when a diagram is heavy (many nodes, long chains).
- If a render times out, retry once before changing the composition; if it times out repeatedly, reduce the diagram's size or complexity.
- A diagram sized for the top 72% (rule 4) is usually also within safe render weight; a diagram that must be large should be capped at ~60% frame height.

### 6. Async-rendered visuals (Mermaid) break deterministic rendering — pre-render to static SVG

HyperFrames seeks compositions frame-by-frame; every frame must be reproducible from its time value alone. Mermaid renders **asynchronously** (Promise-based) and loads external scripts — both violate the determinism rules ("Do not build timelines inside async/Promise/setTimeout", "no render-time network fetches").

- **Pre-render** Mermaid (or any async diagram generator) to a **static SVG** before building the composition. Embed the static SVG in the composition. Never load Mermaid at render time.
- Pre-render via headless Chrome with a virtual-time budget (e.g. `--headless=new --virtual-time-budget=5000 --dump-dom`), then extract the rendered SVG.
- The composition must contain only static, synchronous content — no async diagram rendering, no external diagram scripts.

## The meta-lesson: the engine should own the visual layer

The item-45 mistakes happened because the visual layer was **hand-built outside the engine** with no enforced rules — so each rule was violated at least once before being caught. The durable fix is that the visual layer is built by a code path that **enforces these rules as hard gates** (throw if a diagram has a baked-in max-width, throw if a visual would reach the caption band, throw if an SVG is stretched, etc.), not hand-assembled each time.

Until that code path exists, these rules are the contract. Follow them exactly.

## Reference implementation (verified in item-45)

The verified working pattern from the item-45 Mermaid build:

```css
/* Caption band — fixed reserved zone, bottom ~28% of frame */
.cap {
  position: absolute; left: 0; right: 0; top: 72%; transform: translateY(-50%);
  display: flex; justify-content: center; padding: 0 6%; box-sizing: border-box;
}

/* Visual layer — full-bleed on the canvas, no box, aspect-preserving, above the caption band */
.diagram-wrap {
  flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; min-height: 0;
}
.diagram-wrap svg {
  display: block; max-width: none !important; height: 100%; width: auto; margin: 0 auto;
}
```

- The `.diagram-wrap` sits inside a scene container that occupies the **top 72%** of the frame (the caption band is below it).
- `max-width: none !important` overrides Mermaid's baked-in cap (rule 2).
- `height: 100%; width: auto` preserves aspect ratio (rule 3).
- No background/border/padding on `.diagram-wrap` — the canvas shows through (rule 1).
- The scene container's height is capped so the diagram cannot reach the caption band (rule 4).

## Verification checklist

Before a visual-layer composition is considered done:

- [ ] No white box / panel / card around any visual — the canvas is the background (rule 1)
- [ ] Every diagram fills its container — no thumbnail-sized SVG (rule 2)
- [ ] Every SVG scales uniformly — no `width:100%; height:100%` stretch (rule 3)
- [ ] No visual extends below the `top: 72%` caption line (rule 4)
- [ ] Heavy diagrams capped at ~60% frame height; renders complete without timeout (rule 5)
- [ ] No async diagram rendering in the composition — all diagrams are pre-rendered static SVG (rule 6)
- [ ] Snapshot QA: render frames and eyeball each one — the automated gates miss silent layout bugs