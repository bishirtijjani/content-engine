# Icon sources

Icon geometry comes from the **`@tabler/icons`** npm package (MIT,
https://tabler.io/icons), declared as a devDependency of this workspace.

- The build script reads the package's pre-parsed `tabler-nodes-outline.json`
  (every outline icon's `<path d>` geometry — no SVG parsing, no network).
- It writes `src/diagrams/icons.generated.mjs` (a plain JS table the runtime
  reads with no fs, no network, no dependency). That file is **not committed**
  (see `.gitignore`) so the full ~5,000-icon library stays available without
  bloating the repo. It is produced on install via the package `prepare` script.
- Regenerate any time: `npm run icons` (root) or
  `npm --workspace @content-os/engine-production run icons`.

`tools/build-icons.mjs` holds a small `ALIASES` map (our stable public keys such
as `doc` -> `file-text`) so plans authored against the old icon names keep
resolving. An unknown icon name fails loudly (see `primitives.iconGroup`).
