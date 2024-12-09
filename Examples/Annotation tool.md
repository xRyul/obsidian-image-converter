This is simple tool for quick markups / annotations, when loading whole photoshop or excalidraw instance is too much for such a trivial task. I wanted something what would allow me to quickly do some scribbles over screenshots/ photos from all the lectures I am currently taking. The idea of being able to Paste image/screenshot into the note -> open it inside Obsidian without leaving the context/ note/ or the line your are in -> do some scribbles -> save image back into then note -> continue with the lecture. All without leaving Obsidian, swapping windows, copy pasting, exporting to over applications etc.

- This provides and ability to draw and add text directly on an image.
- Draw or add text inside the image or outside the image. You can zoom out to an almost infinite canvas size. Anything what goes outside image bounds will be saved back into original image.
- Any transparency is always preserved.
- Any changes are permanent and are saved back into the original image.
- Saving flattens any annotation into the image.


https://github.com/user-attachments/assets/19660874-7a92-4784-b3d1-d38135422b8b

## To use:

Right click on any image and select **"Annotate Image**" from the context menu to open it in a new window.

![[Annotation tool-20241209170455987.webp|222]]


## To add annotation:

Simply use 1 of 3 tools: Brush (B), freehand Arrow (A), Text (T)

![[Annotation tool-20241209170512521.webp|86]]


## To modify annotation:

- Selection Tool. Active by default. Deselect active tools (Brush, Arrow, or Text) via shortcuts (B, A, T) or buttons to reactivate the Selection Tool. Use the Selection Tool to move or adjust elements.
- Editing text: Double-click anywhere to create a new text element. Double-click an existing text element to edit it. Text automatically sharpens when scaled to ensure clarity.
- Changing Colors. Select an element and choose a color from the swatches or use the color picker. The color picker allows HEX, HSL, or RGB value input. 6 Dominant colors are automatically calculated, then 6 Complimentary colors at 180 degrees are provided beneath it.
![[Annotation tool-20241209170535346.webp|222]] ![[Annotation tool-20241209170540362.webp|222]]


## To delete:

- Select an element and press either: backspace or delete key.
- To delete all elements. Select all (CMD+A) elements and press either: backspace or delete key. Or use delete button provided.

## To navigate:

- Scroll Wheel: Zoom in and out.
- Spacebar: Pan around the canvas.



### **Blending modes:**

Multiple, Screen, Overlay, Darken, Lighten, Dodge, Burn, Hard Light, Soft Light, Difference, Exclusion.

Normal vs Multiple:
![Obsidian_KhwgtX04aK](https://github.com/user-attachments/assets/7b1500a9-297b-4320-ba5a-9f446c6b3a4c)

### **Tool Presets:** 

Tool presets are reusable and remember the size, opacity and blending mode of the selected tool. Thus it is possible to have e.g. 3 custom brushes: small, medium , large - each with different color, opacity and blending mode. Allowing  to create custom highlighters or markers. Similarly for arrow and text. 

- To create preset: simply select tool you want to create preset for -> select size/opacity/blending mode -> when ready: simply press shift+click onto the preset number to save it

![image](https://github.com/user-attachments/assets/1dc2bcdc-da4a-41d5-af19-118a8978e543)


###  **Backgrounds:** 

Option to select one of 5 custom backgrounds: transparent, white, black, grid, dots. 

Some formats don't allow transparency, thus this allows you to have some control over what color is being used when it is flattened. This also allows you to add background to transparent images. For instance in Dark Mode, it might be hard to see dark transparent image element on dark background, thus it is possible to simply flatten it and use white background instead, for instance:

![Obsidian_MiD9hDcxjo](https://github.com/user-attachments/assets/24ab0e1a-0095-4936-84f5-61eaabd391f8)


![image](https://github.com/user-attachments/assets/9a8a1490-872e-45b5-9e2a-7ed2616e5829)

### **Bring to front and send to back:**

Allows you to modify how selected element overlays another element . For instance it is possible to move one element behind another:

![Obsidian_z8gDgYHWU5](https://github.com/user-attachments/assets/ea312b9d-dbcf-4963-85ba-c9824c9a2153)



### **Text backgrounds:**

https://github.com/user-attachments/assets/38ef5d1f-4cbd-4ce5-9b52-4c830694a0e9

![image](https://github.com/user-attachments/assets/71b8d71d-2608-441a-91cd-b7003b84d23a)

![image](https://github.com/user-attachments/assets/828c1128-719a-45ef-a5fd-cad2c7222e71)




## Notes:
- Saved annotations are flattened into the image and cannot be modified later.
- This is not a replacement for Excalidraw.
- Dropping images into image annotation currently is not supported.
- Highlighting with multiply or linear blending modes currently is not supported.
- Bringing layers to the front or back is only manual, and follows order of creation. I might add some easy to use button later on.
- Arrow tool will automatically create arrowhead in the direction the stroke was done. Smoothing in certain cases might be too strong, and I might look into modifying/adjusting it .
- Creating custom shapes, rectangles, circles is not currently supported. Although I might add some custom background for Text elements, to make separation of text vs background easier (and much faster to create).
- If anyone is good with UI/UX, please help me out 🙏🥲