# Stream Deck icon design

ChatGato's key icons use the open-source
[Lucide](https://lucide.dev/) library so they remain legible on hardware and
coherent as the action set grows. Lucide is distributed under the ISC license.

## Rules

- Key artwork is SVG on a 144 × 144 view box. Stream Deck can scale SVG cleanly;
  raster key art would require 72 × 72 and 144 × 144 variants.
- The common dark shell and subtle inset border make the set read as one family.
- The accent panel occupies `x=28–116`, `y=14–94`. The bottom 50 px remain quiet
  for Stream Deck's one- or two-line title overlay.
- Primary glyphs come from `lucide-static` and retain Lucide's rounded caps,
  joins, and 24 × 24 source geometry. `scripts/lucide-icons.mjs` is the shared
  mapping from ChatGato actions to Lucide icon names.
- Accent colors have stable meaning: blue for navigation and creation, purple for
  reasoning and AI, yellow for enabled controls, green for positive actions, red
  for destructive or failed actions, orange for attention, and slate for neutral
  or disabled states.
- Action-list icons are 20 × 20 SVGs with a transparent background and only
  white (`#FFFFFF`) strokes. They use the same Lucide source as the
  corresponding key glyphs.
- Dynamic states update the accent panel while keeping the shell and title zone
  stable. Their glyphs are also rendered from `lucide-static`, so state changes
  do not switch icon families.
- Usage bars and agent numbers remain generated data displays rather than icon
  artwork.

Regenerate the checked-in assets with:

```bash
npm run icons
```

The generated SVGs include an attribution comment. The complete Lucide and
Feather license notices ship in
`com.marco.chatgato.sdPlugin/LICENSES/Lucide.txt`.

The dimensions and format choices follow Elgato's official
[plugin image guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/)
and [manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/).
