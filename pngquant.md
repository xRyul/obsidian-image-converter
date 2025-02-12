## Image Optimization with PNGQUANT (Optional)

This plugin can optionally use [pngquant](https://pngquant.org/) to optimize PNG images, resulting in significantly smaller file sizes.  **pngquant is not included with this plugin and must be installed separately.**

**License Information:**

pngquant is powered by `libimagequant`, which is dual-licensed under the GPLv3+ and a commercial license.  Because this plugin interacts with `pngquant` as a separate, external process (using standard input/output) and does *not* distribute `libimagequant`'s code, your use of this plugin does *not* require you to license your own work under the GPL.  However, you are responsible for complying with the terms of the `libimagequant` license if you choose to install and use `pngquant`.

**Installation:**

*   **Windows:** Download the `pngquant.exe` executable from the [pngquant website](https://pngquant.org/) and place it in a directory that's in your system's PATH, or specify the full path to the executable in this plugin's settings.
*   **macOS:** You can install `pngquant` using Homebrew: `brew install pngquant`
*   **Linux:** Use your distribution's package manager to install `pngquant` (e.g., `apt-get install pngquant`, `yum install pngquant`, etc.).