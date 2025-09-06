# Notes on file sizes

This plugin tries multiple strategies and picks the smallest result for each image. Then, optionally, it can keep the original if the processed file would be larger.

What happens during conversion
- WEBP/JPEG
  - The plugin renders once and encodes via two browser paths:
    - canvas.toBlob(...)
    - canvas.toDataURL(...)
  - It also compares against “compress original format” for certain inputs.
  - It chooses the smallest of the available candidates.

- PNG
  - Encodes via:
    - canvas.toBlob('image/png', ...)
    - canvas.toDataURL('image/png', ...)
  - It may also compare against “compress original format” when appropriate.
  - It chooses the smallest of the available candidates.

- PNGQUANT (PNG only)
  - Uses the pngquant executable you configure. The result is then compared to the original at save time (see “Revert to original if larger” below).

- AVIF
  - Uses FFmpeg (libaom-av1) with your configured CRF and preset. The result is also compared to the original at save time.

Important: “Revert to original if larger”
- Instead of a per-conversion “allow larger files” switch, the plugin now uses a global setting:
  - Revert to original if larger: When enabled, if the processed result is larger than the original, the plugin keeps the original file instead.
  - Default: OFF
  - Where to find it: Settings → Image Converter → Conversion presets → “Revert to original if larger”

Examples
1) If we get:
   Original: 1.0 MB
   WebP (toBlob): 1.5 MB
   WebP (toDataURL): 1.2 MB
   Compressed original: 0.8 MB
   → The plugin returns the compressed original (0.8 MB) because it’s the smallest.

2) If we get:
   Original: 1.0 MB
   WebP (toBlob): 0.6 MB
   WebP (toDataURL): 0.7 MB
   Compressed original: 0.9 MB
   → The plugin returns the WebP (toBlob) result (0.6 MB) because it’s the smallest.

3) If “Revert to original if larger” is ON and we get:
   Original: 1.0 MB
   WebP (toBlob): 1.2 MB
   WebP (toDataURL): 1.3 MB
   Compressed original: 1.1 MB
   → The plugin keeps the original (1.0 MB) because every processed result is larger.

   If “Revert to original if larger” is OFF, the plugin would save the smallest processed result (1.1 MB in this example), even if it’s larger than the original.

Why this approach
- Adaptive: Picks whatever encoding path compresses best for that specific image.
- Safe (with the setting ON): Won’t increase file size.
- Practical: Different images compress differently (some JPEGs do better as WebP; some PNGs are already optimal; PNGQUANT/AVIF can be excellent depending on content).
