# Vendored icon sources

The SVGs in this folder are the upstream **Tabler Icons** outline files used by
the diagram system. They are vendored so the generated icon table can be
rebuilt offline and so provenance is auditable.

- Source: https://github.com/tabler/tabler-icons (branch `main`, `icons/outline/`)
- License: MIT — see `LICENSE` beside this file.
- Used by: `packages/engine-production/tools/build-icons.mjs`, which reads these
  files and writes `src/diagrams/icons.generated.mjs`.

Our public icon key maps to a file name in `build-icons.mjs` (`ICON_MAP`), for
example `doc` -> `file-text.svg`, `gear` -> `settings.svg`, `chat` -> `message.svg`.

To add an icon: vendor the upstream `.svg` here, add the mapping in
`build-icons.mjs`, then run `npm --workspace @content-os/engine-production run icons`.
