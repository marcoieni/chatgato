# Stream Deck icon design

ChatGato's key icons are generated from one small visual system so they remain
legible on hardware and coherent as the action set grows.

## Rules

- Key artwork is SVG on a 144 × 144 view box. Stream Deck can scale SVG cleanly;
  raster key art would require 72 × 72 and 144 × 144 variants.
- The common dark shell and subtle inset border make the set read as one family.
- The accent panel occupies `x=28–116`, `y=14–94`. The bottom 50 px remain quiet
  for Stream Deck's one- or two-line title overlay.
- Primary glyphs use rounded caps and joins at 7–10 px. Fine detail, gradients
  outside the reasoning family, and text inside ordinary key art are avoided.
- Accent colors have stable meaning: blue for navigation and creation, purple for
  reasoning and AI, green for positive actions, red for destructive or failed
  actions, orange for attention, and slate for neutral or disabled states.
- Action-list icons are 20 × 20 SVGs with a transparent background and only white
  (`#FFFFFF`) strokes. Their shapes mirror the corresponding key glyphs.
- Dynamic states update the accent panel while keeping the shell and title zone
  stable. This makes state changes obvious without sacrificing label contrast.

Regenerate the checked-in assets with:

```bash
npm run icons
```

The dimensions and format choices follow Elgato's official
[plugin image guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/)
and [manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/).
