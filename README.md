# Image Converter for ObsidianMD  
<img width="600" alt="Image-Converter_Settings-sample" src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/75b1eaeb-bd31-4238-a059-a569656b4359">

![258099823-63a0646b-29ec-4055-abfc-55d31e07b2f7](https://github.com/xRyul/obsidian-image-converter/assets/47340038/9d942075-9ecb-4246-8201-07b5d166c0e9)


## Features
- Automatically convert dropped/pasted image into WEBP, JPG or PNG. 
- Automatically convert HEIC and TIF files into WEBP, JPG, or PNG. 
- Reduce file size of an image by specifying desired Quality value between 1-100
- Auto-rename converted image.  
- Auto-resize image based on 6 modes: Fit, Fill, Longest Edge, Shortest Edge, Height, Width
	- Image resize by the Longest Edge
	<video src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/6c287f86-08b8-4483-800d-040dd5207341" width="600px">

- Ability to copy an image into clipboard via right click context menu
	- 	<img src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/2034a444-cd49-4ce0-af98-745694ba4986" width="600px">

- Ability to resize original image via right click context menu
	- <img src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/3367b41c-63fa-4a1c-a616-8561e467eef7" width="600px">
- Ability to resize image by dragging edge of an image
	-  <img src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/5724c6e9-19d4-4eaf-a559-1168f6557a14" width="600px"> 
- Ability to resize image by holding shift + mouse scroll wheel

Supported image formats: WEBP, JPG, PNG, HEIC, TIF

## Quick Summary for Image Compression

The recommended export setting is WEBP set to Quality 75. This is the optimal setting for most types of images.

- 1st place. **JPG to WEBP** at 50 quality: **PSNR = 31.16**, % of compression = -85.9%, file size = 7,482 KB
- 2nd place. PNG to WEBP at 50 quality: PSNR = 29.23, % of compression = -93.5%, file size = 1,520 KB
- 3rd place. WEBP to JPG at 50 quality: PSNR = 32.65, % of compression = -93%, file size = 2,000 KB
- 4th place. PNG to JPG at 50 quality: PSNR = 28.62, % of compression = -92.4%, file size = 1,776 KB
- 5th place. JPG to JPG at 50 quality: PSNR = 29.25, % of compression = -85.8%, file size = 5,926 KB

### Example 1  - Comparison of Original converted to WEBP and JPG with Quality 1

- <video src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/52ffd607-e92c-4b08-bde4-8a389fd992fc" width="600px">

### Example 2 - Comparison of Original converted to WEBP and JPG with Quality 1

- <video src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/6978be85-6f83-47ba-a9df-1f5864c6fbcb" width="600px">

### Example 3 - Comparison between WEBB 100 vs JPG 100 >  WEBB 1 vs JPG 1

- <video src="https://github.com/xRyul/obsidian-image-converter/assets/47340038/aa62380e-b977-42c5-8a2f-71cb09a811b7" width="600px">

### Comparison
#### File size of converting one image format to another:

| From/To | WEBP                                               | JPG                                        | PNG                                         |
| ------- | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| JPG     | 64,122 KB (100) <br> 7,482 KB (50) <br> 480 KB (1) | 52,864 KB (100)<br>5,926KB(50)<br>363KB(1) | 96,556KB(100)<br>44,702KB(50)<br>9,072KB(1) |
| PNG     | 21,812KB(100)<br>1,520KB(50)<br>401KB(1)           | 14,744KB(100)<br>1,776KB(50)<br>163KB(1)   | 29,830KB(100)<br>12,161KB(50)<br>3,226KB(1) |
| WEBP    | 30,960KB(100)<br>1,414KB(50)<br>353KB(1)           | 19,236KB(100)<br>2,000KB(50)<br>189KB(1)   | 43,154KB(100)<br>15,327KB(50)<br>1,806KB(1) |

- The numbers in the parentheses indicate the quality of the conversion. 

#### File size difference after the conversion in %:

The percentage change is calculated by comparing the file size after conversion to the original file size of the image being converted.  

| From/To | WEBP                                                                           | JPG                                                                    | PNG                                    |
| ------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------- |
| JPG     | +21.4% (100)PSNR: 45.85 <br> -85.9% (50)PSNR: 31.16 <br> -99.1% (1)PSNR: 26.28 | +29.3%(100)<br>-85.8%(50) PSNR:29.25<br>-99.3%(1) PSNR:23.2            | +135.9%(100)<br>+8.9%(50)<br>-78%(1)   |
| PNG     | -6.9%(100)PSNR: 34.78<br>-93.5%(50)PSNR: 29.23<br>-98.3%(1)PSNR: 23.52         | -37%(100)PSNR: 35.07<br>-92.4%(50) PSNR: 28.62<br>-99.3%(1)PSNR: 19.52 | +27.4%(100)<br>-48%(50)<br>-86.2%(1)   |
| WEBP    | +8.8%(100)PSNR: 38.46<br>-95%(50)PSNR: 32.72<br>-98.8%(1)PSNR: 27.98           | -32.4%(100)PSNR: 39.04<br>-93%(50)PSNR: 32.65<br>-99.3%(1)PSNR: 22.79  | +51.8%(100)<br>-46.1%(50)<br>-93.6%(1) |


#### PSNR and the loss of quality:  

Below is the table which shows how much quality we lose with each conversion. The lower the PSNR value the lower the quality of an image:  

| From/To | WEBP        | JPG         | PNG |
| ------- | ----------- | ----------- | --- |
| JPG     | 45.85 (100) |             |     |
|         | 31.16 (50)  | 29.25 (50)  |     |
|         | 26.28 (1)   | 23.2 (1)    |     |
| PNG     | 34.78 (100) | 35.07 (100) |     |
|         | 29.23 (50)  | 28.62 (50)  |     |
|         | 23.52 (1)   | 19.52 (1)   |     |
| WEBP    | 38.46 (100) | 39.04 (100) |     |
|         | 32.72 (50)  | 32.65 (50)  |     |
|         | 27.98 (1)   | 22.79 (1)   |     |

### Conclusion

- Based on the tests above, using **WEBP as the target format for image compression can result in significant reductions in file size while maintaining high image quality**.
- WEBP generally provides the best compression ratio, with the lowest file sizes for all quality levels (100, 50, and 1) when converting from JPG and PNG.
- Converting from WEBP to other formats results in larger file sizes, indicating that WEBP is more efficient in compressing image data.
- The PSNR values indicate that the quality of the compressed images is generally high, with values above 30 for most conversions at 50 quality.
- The % of compression values show that significant reductions in file size can be achieved by converting to WEBP or JPG at lower quality levels.
- The % of compression values show that converting from PNG to JPG or WEBP at 50 quality results in significant reductions in file size, with reductions of over 90% in both cases.
- Converting from JPG to PNG at any quality level results in an increase in file size, indicating that PNG is not as efficient as WEBP or JPG in compressing image data.
- The PSNR values for conversions from PNG to JPG or WEBP at 50 quality are also relatively high, indicating that the quality of the compressed images is still good despite the large reductions in file size.



## To-do  

- [FIX] No active-file on 1st drop. 
- Add support for HEIC, TIF, PSD, AVIF.
- Add basic Resize/Edit features.  
    - Add auto background removal
    - Add autoCrop with specific margins
- Add better compression algorithms: mozJPEG, PngQUANT, OxiPNG, WEBP v2, JPEG XL~.
- Add the ability for the user to choose/define custom NEW FILENAME.
- Improve notification to add clarity on what is happening .
- Improve conversion speed for large files 100MB+ .

## How to install
1. Downlaod `main.js`, `manifest.json` files from this repo.
2. Creane new folder inside `VaultFolder/.obsidian/plugins/` named  `obsidian-image-converter` . If plugins folder doesn't exist, then create it manually. 
3. Move downloaded files into `/obsidian-image-converter` folder. 
4. Enable the plugin in ObsidianMD. 

# Credits
- This repo is heavily inspired by https://github.com/musug/obsidian-paste-png-to-jpeg musug has created an amazing ground work for the project, but sadly who has gone AWOL leaving the project behind without fixing some major issues. Hence, this is an attempt to rejuvenate the project.



