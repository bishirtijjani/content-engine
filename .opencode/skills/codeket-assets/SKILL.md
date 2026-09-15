---
name: codeket-assets
description: >-
  Generate on-brand Bishir Tijjani visual assets as HTML/CSS — Instagram posts, carousel
  slides, hook cards, quote cards, proof/result cards, CTA end-cards, UI mockups,
  data/stat cards, and web sections. Use when the user asks to "make a post", "design
  a slide", "create a carousel", "make a hook card", "build a mockup", "a stat card",
  "a quote graphic", or any branded graphic for @iambishir. Applies the
  locked 60/30/10 color rule, Montserrat/Plus Jakarta Sans/JetBrains Mono type, and the
  orange + navy accent system.
---

# Bishir Tijjani Assets

Generate branded visual assets as self-contained HTML/CSS that the user screenshots or exports to PNG. Every asset obeys the locked Bishir Tijjani brand system. Never invent new colors, fonts, or layouts — pull from the tokens and templates here.

## Before generating

1. Read `references/tokens.css` — the single source of truth for colors, type, spacing, radii, shadows. Inline these variables into every asset so it renders standalone.
2. Read `references/brand-kit.md` for voice, account differentiation, and the locked visual rules.
3. Determine the **account**: `@iambishir` (founder → navy leads on orange background).
4. Determine the **format/ratio**: feed post 4:5, carousel/square 1:1, reel/story 9:16, or web section.

## The 60 / 30 / 10 rule — non-negotiable

- **60%** orange `#EA580C` carries the frame (background/surface).
- **30%** white `#FFFFFF` text does the reading.
- **10%** accent (navy `#0f4c81` — key highlighted words, CTAs, underlines).

If a draft uses more than ~10% accent area, cut it back. Accent is a signal, not decoration.

## Type rules

- **Montserrat** 800–900, ALL-CAPS for hooks and headers. Letter-spacing tight.
- **Plus Jakarta Sans** 400–600 for body, captions, sub-text.
- **JetBrains Mono** for tech labels, `// code-style` tags, meta, timestamps.
- Never a fourth font. All text must have a shadow at all times.
- **Text shadow (always):** `text-shadow: 0 2px 6px rgba(0,0,0,.85), 0 6px 22px rgba(0,0,0,.75);`

## Asset templates

Each template is a fixed layout. Copy the structure, swap the copy. Full markup patterns live in `references/asset-templates.html` — read it and adapt.

- **Hook slide (4:5)** — mono tag, big Montserrat hook bottom-aligned with ONE accent word, sub-line, footer handle. Optional darkened photo behind (orange overlay gradient).
- **Carousel body (1:1)** — "03/06" progress tag, numbered points, "keep swiping →" footer.
- **Quote / authority card (1:1)** — large accent quote mark, mixed-case statement with one accent phrase, attribution.
- **Proof / result card (1:1)** — big accent stat (e.g. `-70%`), one-line outcome, client + product, handle. Optional photo behind.
- **CTA end-card (4:5)** — center hook, one filled accent button, "link in bio · contact@bishirtijjani.com".
- **UI mockup** — orange browser window (traffic-light dots + mono URL) framing a screenshot or styled dashboard; KPIs use one accent number max.
- **Phone demo** — dark device frame, orange screen, AI-receptionist chat with accent outgoing bubbles.
- **Data / stat card** — CSS/SVG bar or donut chart on an orange card; muted series + ONE accent series; or a big-number stat block.

## Caption style (for reels / video stills)

Locked spec — apply whenever putting captions on footage:

- Text is **mostly white** on orange background. Emphasis words in navy.
- **No border, no background — ever.** Only a strong drop shadow:
  `text-shadow: 0 2px 6px rgba(0,0,0,.85), 0 6px 22px rgba(0,0,0,.75);`
- All text must have a shadow at all times, on any background.
- Reveal **one phrase at a time** (not word-by-word, not the whole sentence). Example: "I am a software developer and AI engineer" → `I AM A` → `SOFTWARE DEVELOPER` → `AND AI ENGINEER`.
- **Emphasis words are much bigger**, each on **its own line**, in navy.
- Montserrat 800–900, ALL-CAPS, centered low-third.

## Output workflow

1. Build the asset as one self-contained `.html` file in the outputs folder (inline all CSS from tokens; load fonts from Google Fonts).
2. Set the correct `aspect-ratio` on the canvas for the target platform.
3. Present the file to the user with `present_files`.
4. Offer to render it to PNG at export size if a headless browser / sandbox is available (e.g. via `wkhtmltoimage` or a screenshot script). Tell the user they can also just screenshot the frame.
5. Remind that stock photos/video are placeholders — swap for real Bishir Tijjani screenshots before publishing.

## Guardrails

Do: let orange dominate; one navy accent highlight; frame every screenshot/video on orange; match accent to account.
Don't: flood accent; mix orange + navy at equal weight in one asset; add a fourth font; run raw unframed footage.
