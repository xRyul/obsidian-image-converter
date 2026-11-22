# Notes on file sizes

This plugin tries multiple strategies and picks the smallest result for each image. Then, optionally, it can keep the original if the processed file would be larger.

What happens during conversion
- WEBP/JPEG
  - The plugin renders once and encodes via two browser paths:
    - canvas.toBlob(...)
    - canvas.toDataURL(...)
  - It chooses the smaller of the two.

- PNG
  - Encodes via:
    - canvas.toBlob('image/png', ...)
    - canvas.toDataURL('image/png', ...)
  - It chooses the smaller of the two.

- Every candidate is in the format you chose, so a converted image matches its extension. If the image is already in that format and there is nothing to compress or resize (quality 100, or full colour depth for PNG), the plugin keeps the file as it is.

- PNGQUANT (PNG only)
  - Uses the pngquant executable you configure. The result is then compared to the original at save time (see “Revert to original if larger” below).

- AVIF
  - Uses FFmpeg (libaom-av1) with your configured CRF and preset. The result is also compared to the original at save time.

Important: “Revert to original if larger”
- Instead of a per-conversion “allow larger files” switch, each conversion preset has this setting:
  - Revert to original if larger: When enabled, if the processed result is larger than the original, the plugin keeps the original file instead.
  - Minimum compression savings (KB): the processed result must be smaller by at least this much, or the original is kept.
  - The original keeps its own extension. A PNG is saved as .png, even when the preset converts to WebP, so the file name matches its content.
  - It applies to drop and paste, to the “Process image” window and to the batch commands (note, folder, vault). The window and the batch commands have no preset of their own: they use the conversion preset that is selected in the settings.
  - Default: OFF
  - Where to find it: Settings → Image Converter → Conversion presets → “Revert to original if larger”

When a conversion does not work
- If an image cannot be converted (for example, a file that the browser cannot decode), the plugin keeps the original file with its own name and extension. It does not save the original under the extension of the new format.
- A batch command leaves that file as it is and tells you how many images were left unchanged.

Examples
1) If we get:
   Original: 1.0 MB
   WebP (toBlob): 0.6 MB
   WebP (toDataURL): 0.7 MB
   → The plugin returns the WebP (toBlob) result (0.6 MB) because it’s the smallest.

2) If “Revert to original if larger” is ON and we get:
   Original: 1.0 MB
   WebP (toBlob): 1.2 MB
   WebP (toDataURL): 1.3 MB
   → The plugin keeps the original (1.0 MB) because every processed result is larger. It is saved with its own extension (for example .png), not .webp.

   If “Revert to original if larger” is OFF, the plugin would save the smallest processed result (1.2 MB in this example), even if it’s larger than the original.

Why this approach
- Adaptive: Picks whatever encoding path compresses best for that specific image.
- Safe (with the setting ON): Won’t increase file size.
- Practical: Different images compress differently (some JPEGs do better as WebP; some PNGs are already optimal; PNGQUANT/AVIF can be excellent depending on content).
