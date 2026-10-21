# Bundled typefaces

The application serves these font files from its own origin. No font CDN or analytics request is made at runtime. Copyright and license notices travel with the fonts in both Git and the Docker image.

| Typeface | Source | License | Local file |
| --- | --- | --- | --- |
| Noto Sans KR | [Google Fonts distribution](https://github.com/google/fonts/tree/main/ofl/notosanskr) | [SIL OFL 1.1](NotoSansKR-OFL.txt) | NotoSansKR-Variable.woff2 |
| JetBrains Mono | [Official JetBrains repository](https://github.com/JetBrains/JetBrainsMono/tree/master/fonts/webfonts) | [SIL OFL 1.1](JetBrainsMono-OFL.txt) | JetBrainsMono-Variable.woff2 |

Retrieved on 2026-10-21. The source URLs, SHA-256 digests, transformation notes, and bundled file sizes are recorded in [manifest.json](manifest.json).

Noto Sans KR was converted from the official variable TrueType file to a WOFF2 container using FontTools and Brotli. All glyphs and the 100–900 weight axis are retained; glyphs have not been subset or redrawn. The reserved name in the upstream license is `Source`, which is not used as the bundled family name. The WOFF2 file is approximately 3.9 MB and is loaded once, with `font-display: swap` and browser caching. JetBrains Mono is the official unmodified variable WOFF2, with a 100–800 weight axis.

Latin characters use JetBrains Mono through a limited Unicode range. Hangul and other text fall back to Noto Sans KR. The layout does not scale text through a transformed scene element. Decorative character animation respects `prefers-reduced-motion` and the in-app motion toggle.
