import { App, Component, Modal, Notice, TFile } from 'obsidian';


type SupportedImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export class Crop extends Modal {
	private componentContainer = new Component();

	private readonly MODAL_PADDING = 16;
	private readonly HEADER_HEIGHT = 60;
	private readonly FOOTER_HEIGHT = 60;
	private readonly ASPECT_RATIO_HEIGHT = 80;
	
	// Calculate total chrome height (all UI elements except image)
	private readonly CHROME_HEIGHT = this.HEADER_HEIGHT + this.FOOTER_HEIGHT + this.ASPECT_RATIO_HEIGHT;
	
	// Minimum dimensions
	private readonly MIN_WIDTH = 320;
	private readonly MIN_HEIGHT = 400;

	private readonly STATIC_DESKTOP_WIDTH_RATIO = 0.9; // 80% of window width
	private readonly STATIC_DESKTOP_HEIGHT_RATIO = 0.9; // 80% of window height


    private imageFile: TFile;
    private originalArrayBuffer: ArrayBuffer | null = null;
    private cropContainer: HTMLDivElement;
    private selectionArea: HTMLDivElement;
    private isDrawing = false;
    private startX = 0;
    private startY = 0;
    private originalImage: HTMLImageElement;
    private imageScale: { x: number, y: number } = { x: 1, y: 1 };

	private currentAspectRatio: number | null = null;

	private currentRotation = 0;
	private isFlippedX = false;
	private isFlippedY = false;

	private zoom = 1;
	private readonly MIN_ZOOM = 0.1;
	private readonly MAX_ZOOM = 5;
	private readonly ZOOM_STEP = 0.1;

	constructor(app: App, imageFile: TFile) {
		super(app);
		this.imageFile = imageFile;
		this.componentContainer.load();
		this.containerEl.addClass('crop-tool-modal');
	}

	private setupEventListeners() {
        // Mouse down - start drawing selection
        this.componentContainer.registerDomEvent(this.cropContainer, 'mousedown', (e: MouseEvent) => {
            if (e.target === this.originalImage) {
                this.isDrawing = true;
                const rect = this.cropContainer.getBoundingClientRect();
                this.startX = e.clientX - rect.left;
                this.startY = e.clientY - rect.top;
                
                this.selectionArea.style.display = 'block';
                this.selectionArea.style.left = `${this.startX}px`;
                this.selectionArea.style.top = `${this.startY}px`;
                this.selectionArea.style.width = '0';
                this.selectionArea.style.height = '0';
            }
        });

        // Mouse move - update selection size
        this.componentContainer.registerDomEvent(this.cropContainer, 'mousemove', (e: MouseEvent) => {
            if (!this.isDrawing) return;
            const rect = this.cropContainer.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            this.updateSelectionSize(currentX, currentY);
        });

        // Mouse up - finish drawing selection
        this.componentContainer.registerDomEvent(this.cropContainer, 'mouseup', (e: MouseEvent) => {
            this.isDrawing = false;
            this.makeSelectionMovable();
        });

        // Prevent selection from getting stuck if mouse leaves the container
        this.componentContainer.registerDomEvent(this.cropContainer, 'mouseleave', (e: MouseEvent) => {
            this.isDrawing = false;
        });
    }

    async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Add a wrapper div for better control of modal size
		const modalWrapper = contentEl.createDiv('crop-modal-wrapper');
	
		// Create modal structure
		const modalHeader = modalWrapper.createDiv('crop-modal-header');
		modalHeader.createEl('h2', { text: 'Crop image' });
	
		// Create main container
		const modalContent = modalWrapper.createDiv('crop-modal-content');
		this.cropContainer = modalContent.createDiv('crop-container');
			
		// Create selection area
		this.selectionArea = this.cropContainer.createDiv('selection-area');
		this.selectionArea.style.display = 'none';
	
		// Register events early so drawing works even before image load completes
		this.setupEventListeners();
	
		// Create buttons - Move this inside modalWrapper
		const buttonContainer = modalWrapper.createDiv('crop-modal-buttons');
		const saveButton = buttonContainer.createEl('button', { text: 'Save' });
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		const resetButton = buttonContainer.createEl('button', { text: 'Reset' });
		
		// Add aspect ratio controls
		const aspectRatioContainer = modalHeader.createDiv('aspect-ratio-controls');
		
		// Add transform controls
		this.createTransformControls(aspectRatioContainer);
		aspectRatioContainer.createEl('span', { text: ' ' });
		
		// Create ratio buttons container
		const ratioButtonsContainer = aspectRatioContainer.createDiv('ratio-buttons-container');

		// Add preset ratio buttons
		[
			{ name: 'free', ratio: null, label: 'Free' },
			{ name: 'square', ratio: 1, label: '1:1' },
			{ name: '16:9', ratio: 16/9, label: '16:9' },
			{ name: '4:3', ratio: 4/3, label: '4:3' },
		].forEach(({ name, ratio, label }) => {
			const button = ratioButtonsContainer.createEl('button', {
				text: label,
				cls: 'aspect-ratio-button'
			});
			
			this.componentContainer.registerDomEvent(button, 'click', () => {
				// Remove active class from all buttons
				aspectRatioContainer.querySelectorAll('.aspect-ratio-button').forEach(btn => 
					btn.removeClass('active'));
				
				// Add active class to clicked button
				button.addClass('active');
				
				// Clear custom inputs when selecting a preset
				if (ratio !== null) {
					widthInput.value = '';
					heightInput.value = '';
				}
				
				this.currentAspectRatio = ratio;
				
				// If there's an existing selection, adjust it to the new aspect ratio
				if (this.selectionArea.style.display !== 'none') {
					this.adjustSelectionToAspectRatio();
				}
			});

			// Set free as default active
			if (name === 'free') {
				button.addClass('active');
			}
		});

		// Create custom ratio inputs
		const customRatioContainer = aspectRatioContainer.createDiv('custom-ratio-container');
		
		const widthInput = customRatioContainer.createEl('input', {
			type: 'number',
			placeholder: 'W',
			cls: 'custom-ratio-input'
		});
		
		customRatioContainer.createEl('span', { text: ':' });
		
		const heightInput = customRatioContainer.createEl('input', {
			type: 'number',
			placeholder: 'H',
			cls: 'custom-ratio-input'
		});

		// Function to update custom ratio
		const updateCustomRatio = () => {
			const width = parseFloat(widthInput.value);
			const height = parseFloat(heightInput.value);
			
			if (width > 0 && height > 0) {
				// Remove active class from preset buttons
				aspectRatioContainer.querySelectorAll('.aspect-ratio-button').forEach(btn => 
					btn.removeClass('active'));
					
				this.currentAspectRatio = width / height;
				if (this.selectionArea.style.display !== 'none') {
					this.adjustSelectionToAspectRatio();
				}
			}
		};

		// Add input event listeners for immediate updates
		this.componentContainer.registerDomEvent(widthInput, 'input', updateCustomRatio);
		this.componentContainer.registerDomEvent(heightInput, 'input', updateCustomRatio);

		// Add image controls (rotation and zoom)
		this.createImageControls(modalHeader);

        // Early Escape key handler so reset works even before image load completes
        this.componentContainer.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.resetSelection();
                // keep modal open; prevent default close behavior
                e.stopPropagation();
            }
        });

        try {
            await this.loadImage();

            // Add button listeners
            this.componentContainer.registerDomEvent(saveButton, 'click', () => this.saveImage());
            this.componentContainer.registerDomEvent(cancelButton, 'click', () => this.close());
            this.componentContainer.registerDomEvent(resetButton, 'click', () => this.resetSelection());
        } catch (error) {
            new Notice('Error loading image for cropping');
            console.error('Crop modal error:', error);
            this.close();
        }
    }

    private async loadImage() {
        this.originalArrayBuffer = await this.app.vault.readBinary(this.imageFile);
        const blob = new Blob([this.originalArrayBuffer]);
        const imageUrl = URL.createObjectURL(blob);

        // Create and load the original image
        this.originalImage = document.createElement('img');
        this.originalImage.className = 'crop-original-image';

        // Append the image element immediately so tests (and UI) can reference it before load
        // The sizing and scale will still be initialized on load below
        if (!this.originalImage.parentElement) {
            this.cropContainer.appendChild(this.originalImage);
        }
        
        return new Promise<void>((resolve, reject) => {
            this.originalImage.onload = () => {
				this.adjustModalSize();

                // Calculate scaling factors
                this.imageScale.x = this.originalImage.naturalWidth / this.originalImage.clientWidth;
                this.imageScale.y = this.originalImage.naturalHeight / this.originalImage.clientHeight;
                resolve();
            };
            this.originalImage.onerror = reject;
            this.originalImage.src = imageUrl;
        });
    }

	private adjustModalSize() {
		if (!this.originalImage) return;
	
		const modalElement = this.containerEl.querySelector('.modal') as HTMLElement;
		if (!modalElement) return;
	
		const isMobile = window.innerWidth <= 768;
		
		// Get image dimensions
		const imgWidth = this.originalImage.naturalWidth;
		const imgHeight = this.originalImage.naturalHeight;
		const imgAspectRatio = imgWidth / imgHeight;
	
		let modalWidth, modalHeight;
	
		if (isMobile) {
			// Mobile layout: full width with padding
			modalWidth = window.innerWidth - (this.MODAL_PADDING * 2);
			modalHeight = Math.min(
				window.innerHeight - (this.MODAL_PADDING * 2),
				modalWidth / imgAspectRatio + this.CHROME_HEIGHT
			);
		} else {
			// Desktop layout: static size at 80% of window
			modalWidth = window.innerWidth * this.STATIC_DESKTOP_WIDTH_RATIO;
			modalHeight = window.innerHeight * this.STATIC_DESKTOP_HEIGHT_RATIO;
	
			// Ensure the image container maintains aspect ratio within these bounds
			const availableImageHeight = modalHeight - this.CHROME_HEIGHT;
			const availableImageWidth = modalWidth;
	
			// Adjust container size to maintain aspect ratio
			if (imgAspectRatio > availableImageWidth / availableImageHeight) {
				// Image is wider than available space
				modalHeight = (modalWidth / imgAspectRatio) + this.CHROME_HEIGHT;
			} else {
				// Image is taller than available space
				modalWidth = (availableImageHeight * imgAspectRatio);
			}
		}
	
		// Apply minimum dimensions
		modalWidth = Math.max(this.MIN_WIDTH, modalWidth);
		modalHeight = Math.max(this.MIN_HEIGHT, modalHeight);
	
		// Apply styles
		modalElement.style.width = `${modalWidth}px`;
		modalElement.style.height = `${modalHeight}px`;
		modalElement.style.top = '50%';
		modalElement.style.left = '50%';
		modalElement.style.transform = 'translate(-50%, -50%)';
	}

   // Flip/ Rotate 
	private createTransformControls(modalHeader: HTMLElement) {
		const transformControls = modalHeader.createDiv({ cls: 'transform-controls' });
		
		// Rotation controls
		const rotateContainer = transformControls.createDiv({ cls: 'rotate-container' });
		
		const rotateLeftBtn = rotateContainer.createEl('button', {
			cls: 'transform-button',
			text: '↺',
			attr: { title: '90° Counter Clockwise' }
		});
		
		const rotateRightBtn = rotateContainer.createEl('button', {
			cls: 'transform-button',
			text: '↻',
			attr: { title: '90° Clockwise' }
		});
		
		// Flip controls
		const flipContainer = transformControls.createDiv({ cls: 'flip-container' });
		
		const flipHorizontalBtn = flipContainer.createEl('button', {
			cls: 'transform-button',
			text: '↔',
			attr: { title: 'Flip Horizontally' }
		});
		
		const flipVerticalBtn = flipContainer.createEl('button', {
			cls: 'transform-button',
			text: '↕',
			attr: { title: 'Flip Vertically' }
		});
		
		// Add event listeners
		this.componentContainer.registerDomEvent(rotateLeftBtn, 'click', () => this.rotate(-90));
		this.componentContainer.registerDomEvent(rotateRightBtn, 'click', () => this.rotate(90));
		this.componentContainer.registerDomEvent(flipHorizontalBtn, 'click', () => this.flip('horizontal'));
		this.componentContainer.registerDomEvent(flipVerticalBtn, 'click', () => this.flip('vertical'));
	}

	private rotate(degrees: number) {
		this.currentRotation = (this.currentRotation + degrees) % 360;
		this.applyTransforms();
	}
	
	private flip(direction: 'horizontal' | 'vertical') {
		if (direction === 'horizontal') {
			this.isFlippedX = !this.isFlippedX;
		} else {
			this.isFlippedY = !this.isFlippedY;
		}
		this.applyTransforms();
	}
	



	// Zoom / Rotate slider 
	private createImageControls(modalHeader: HTMLElement) {
		const controlsContainer = modalHeader.createDiv({ cls: 'image-controls' });

		// Rotation controls
		const rotationContainer = controlsContainer.createDiv({ cls: 'control-group rotation-controls' });
		rotationContainer.createEl('span', { text: 'Rotation: ', cls: 'control-label' });

		const rotationValue = rotationContainer.createEl('span', {
			text: '0°',
			cls: 'rotation-value'
		});

		const rotationSlider = rotationContainer.createEl('input', {
			type: 'range',
			cls: 'slider rotation-slider',
			attr: {
				min: '0',
				max: '360',
				value: '0',
				// disabled: 'true'
			}
		});

		// Zoom controls
		const zoomContainer = controlsContainer.createDiv({ cls: 'control-group zoom-controls' });
		zoomContainer.createEl('span', { text: 'Zoom: ', cls: 'control-label' });

		const zoomValue = zoomContainer.createEl('span', {
			text: '100%',
			cls: 'zoom-value'
		});

		const zoomSlider = zoomContainer.createEl('input', {
			type: 'range',
			cls: 'slider zoom-slider',
			attr: {
				min: String(this.MIN_ZOOM * 100),
				max: String(this.MAX_ZOOM * 100),
				value: '100'
			}
		});

		// Add event listeners
		this.componentContainer.registerDomEvent(rotationSlider, 'input', (e: Event) => {
			const value = parseInt((e.target as HTMLInputElement).value);
			this.currentRotation = value;
			rotationValue.textContent = `${value}°`;
			this.applyTransforms();
		});

		this.componentContainer.registerDomEvent(zoomSlider, 'input', (e: Event) => {
			const value = parseInt((e.target as HTMLInputElement).value);
			this.zoom = value / 100;
			zoomValue.textContent = `${value}%`;
			this.applyTransforms();
		});

		// Add mouse wheel zoom
		if (this.cropContainer) {
			this.componentContainer.registerDomEvent(this.cropContainer, 'wheel', (e: WheelEvent) => {
				e.preventDefault();

				const delta = -Math.sign(e.deltaY) * this.ZOOM_STEP;
				const newZoom = Math.max(this.MIN_ZOOM,
					Math.min(this.MAX_ZOOM, this.zoom + delta));

				if (newZoom !== this.zoom) {
					this.zoom = newZoom;
					zoomSlider.value = String(this.zoom * 100);
					zoomValue.textContent = `${Math.round(this.zoom * 100)}%`;
					this.applyTransforms();
				}
			});
		}
	}

	private applyTransforms() {
		const transforms: string[] = [];
		
		// Add zoom
		if (this.zoom !== 1) {
			transforms.push(`scale(${this.zoom})`);
		}
		
		// Add rotation
		if (this.currentRotation !== 0) {
			transforms.push(`rotate(${this.currentRotation}deg)`);
		}
		
		// Add flips
		if (this.isFlippedX) {
			transforms.push('scaleX(-1)');
		}
		if (this.isFlippedY) {
			transforms.push('scaleY(-1)');
		}
		
		this.originalImage.style.transform = transforms.join(' ');
		
		// Adjust container size if needed
		if (Math.abs(this.currentRotation) === 90 || 
			Math.abs(this.currentRotation) === 270 ||
			this.zoom !== 1) {
			this.adjustModalSize();
		}
	}

	private makeSelectionMovable() {
		this.addResizeHandles();
		this.setupResizeHandlers();
		
		let isDragging = false;
		let dragStartX = 0;
		let dragStartY = 0;
		let initialLeft = 0;
		let initialTop = 0;
	
		this.componentContainer.registerDomEvent(this.selectionArea, 'mousedown', (e: MouseEvent) => {
			e.stopPropagation(); // Prevent container's mousedown from firing
			isDragging = true;
			
			// Store the initial positions
			initialLeft = parseInt(this.selectionArea.style.left) || 0;
			initialTop = parseInt(this.selectionArea.style.top) || 0;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			
			this.selectionArea.style.cursor = 'move';
		});
	
		this.componentContainer.registerDomEvent(document, 'mousemove', (e: MouseEvent) => {
			if (!isDragging) return;
	
			// Calculate the distance moved from the start position
			const deltaX = e.clientX - dragStartX;
			const deltaY = e.clientY - dragStartY;
	
			// Calculate new positions
			let newLeft = initialLeft + deltaX;
			let newTop = initialTop + deltaY;
	
			// Get container boundaries
			const containerRect = this.cropContainer.getBoundingClientRect();
			const selectionRect = this.selectionArea.getBoundingClientRect();
	
			// Constrain to container boundaries
			newLeft = Math.max(0, Math.min(newLeft, containerRect.width - selectionRect.width));
			newTop = Math.max(0, Math.min(newTop, containerRect.height - selectionRect.height));
	
			// Apply new position
			this.selectionArea.style.left = `${newLeft}px`;
			this.selectionArea.style.top = `${newTop}px`;
		});
	
		this.componentContainer.registerDomEvent(document, 'mouseup', (e: MouseEvent) => {
			isDragging = false;
			this.selectionArea.style.cursor = 'move';
		});
	}

	// Add this method to handle aspect ratio constraints during drawing
	private updateSelectionSize(currentX: number, currentY: number) {
		let width = currentX - this.startX;
		let height = currentY - this.startY;

		if (this.currentAspectRatio) {
			// Maintain aspect ratio while drawing
			const absWidth = Math.abs(width);
			const absHeight = Math.abs(height);

			if (absWidth / absHeight > this.currentAspectRatio) {
				// Width is too big, adjust it
				width = Math.sign(width) * absHeight * this.currentAspectRatio;
			} else {
				// Height is too big, adjust it
				height = Math.sign(height) * absWidth / this.currentAspectRatio;
			}
		}

		// Handle negative dimensions (drawing from right to left or bottom to top)
		if (width < 0) {
			this.selectionArea.style.left = `${this.startX + width}px`;
			this.selectionArea.style.width = `${Math.abs(width)}px`;
		} else {
			this.selectionArea.style.left = `${this.startX}px`;
			this.selectionArea.style.width = `${width}px`;
		}

		if (height < 0) {
			this.selectionArea.style.top = `${this.startY + height}px`;
			this.selectionArea.style.height = `${Math.abs(height)}px`;
		} else {
			this.selectionArea.style.top = `${this.startY}px`;
			this.selectionArea.style.height = `${height}px`;
		}
	}

	// Add this method to adjust existing selection to new aspect ratio
	private adjustSelectionToAspectRatio() {
		if (!this.currentAspectRatio) return; // Don't adjust if free form

		const currentWidth = parseInt(this.selectionArea.style.width);
		const currentHeight = parseInt(this.selectionArea.style.height);
		
		if (currentWidth / currentHeight > this.currentAspectRatio) {
			// Adjust width to match height * ratio
			const newWidth = currentHeight * this.currentAspectRatio;
			this.selectionArea.style.width = `${newWidth}px`;
		} else {
			// Adjust height to match width / ratio
			const newHeight = currentWidth / this.currentAspectRatio;
			this.selectionArea.style.height = `${newHeight}px`;
		}
	}


	private addResizeHandles() {
		// Create resize handles for all corners and edges
		const handles = [
			'nw', 'n', 'ne',
			'w', 'e',
			'sw', 's', 'se'
		];
	
		handles.forEach(position => {
			const handle = document.createElement('div');
			handle.className = `resize-handle ${position}-resize`;
			this.selectionArea.appendChild(handle);
		});
	}
	
	private setupResizeHandlers() {
		let isResizing = false;
		let currentHandle: string | null = null;
		let startX = 0;
		let startY = 0;
		let startWidth = 0;
		let startHeight = 0;
		let startLeft = 0;
		let startTop = 0;
	
		const handles = this.selectionArea.querySelectorAll('.resize-handle');
	
		handles.forEach(handle => {
			this.componentContainer.registerDomEvent(handle as HTMLElement, 'mousedown', (e: MouseEvent) => {
				e.stopPropagation(); // Prevent dragging from starting
				isResizing = true;
				const [, handleClass] = handle.className.split(' ');
				[currentHandle] = handleClass.split('-'); // Get position (nw, n, ne, etc.)
				
				startX = e.clientX;
				startY = e.clientY;
				startWidth = this.selectionArea.offsetWidth;
				startHeight = this.selectionArea.offsetHeight;
				startLeft = this.selectionArea.offsetLeft;
				startTop = this.selectionArea.offsetTop;
			});
		});
	
		this.componentContainer.registerDomEvent(document, 'mousemove', (e: MouseEvent) => {
			if (!isResizing) return;
	
			const deltaX = e.clientX - startX;
			const deltaY = e.clientY - startY;
			
			let newWidth = startWidth;
			let newHeight = startHeight;
			let newLeft = startLeft;
			let newTop = startTop;
	
			// Calculate new dimensions based on which handle is being dragged
			switch (currentHandle) {
				case 'se':
					newWidth = startWidth + deltaX;
					newHeight = this.currentAspectRatio 
						? newWidth / this.currentAspectRatio 
						: startHeight + deltaY;
					break;
				case 'sw':
					newWidth = startWidth - deltaX;
					newHeight = this.currentAspectRatio 
						? newWidth / this.currentAspectRatio 
						: startHeight + deltaY;
					newLeft = startLeft + deltaX;
					break;
				case 'ne':
					newWidth = startWidth + deltaX;
					newHeight = this.currentAspectRatio 
						? newWidth / this.currentAspectRatio 
						: startHeight - deltaY;
					newTop = startTop + (startHeight - newHeight);
					break;
				case 'nw':
					newWidth = startWidth - deltaX;
					newHeight = this.currentAspectRatio 
						? newWidth / this.currentAspectRatio 
						: startHeight - deltaY;
					newLeft = startLeft + deltaX;
					newTop = startTop + (startHeight - newHeight);
					break;
				case 'n':
					newHeight = startHeight - deltaY;
					if (this.currentAspectRatio) {
						newWidth = newHeight * this.currentAspectRatio;
						newLeft = startLeft + (startWidth - newWidth) / 2;
					}
					newTop = startTop + deltaY;
					break;
				case 's':
					newHeight = startHeight + deltaY;
					if (this.currentAspectRatio) {
						newWidth = newHeight * this.currentAspectRatio;
						newLeft = startLeft + (startWidth - newWidth) / 2;
					}
					break;
				case 'e':
					newWidth = startWidth + deltaX;
					if (this.currentAspectRatio) {
						newHeight = newWidth / this.currentAspectRatio;
						newTop = startTop + (startHeight - newHeight) / 2;
					}
					break;
				case 'w':
					newWidth = startWidth - deltaX;
					if (this.currentAspectRatio) {
						newHeight = newWidth / this.currentAspectRatio;
						newTop = startTop + (startHeight - newHeight) / 2;
					}
					newLeft = startLeft + deltaX;
					break;
			}
	
			// Constrain to container boundaries
			const containerRect = this.cropContainer.getBoundingClientRect();
			newWidth = Math.max(20, Math.min(newWidth, containerRect.width - newLeft));
			newHeight = Math.max(20, Math.min(newHeight, containerRect.height - newTop));
			newLeft = Math.max(0, Math.min(newLeft, containerRect.width - newWidth));
			newTop = Math.max(0, Math.min(newTop, containerRect.height - newHeight));
	
			// Apply new dimensions
			this.selectionArea.style.width = `${newWidth}px`;
			this.selectionArea.style.height = `${newHeight}px`;
			this.selectionArea.style.left = `${newLeft}px`;
			this.selectionArea.style.top = `${newTop}px`;
		});
	
		this.componentContainer.registerDomEvent(document, 'mouseup', (e: MouseEvent) => {
			isResizing = false;
			currentHandle = null;
		});
	}


    private resetSelection() {
        this.selectionArea.style.display = 'none';
        this.selectionArea.style.width = '0';
        this.selectionArea.style.height = '0';
    }

	async saveImage() {
		try {
			const originalCanvas = document.createElement('canvas');
			const originalCtx = originalCanvas.getContext('2d');
			if (!originalCtx) {
				throw new Error('Could not get canvas context');
			}
			originalCanvas.width = this.originalImage.naturalWidth;
			originalCanvas.height = this.originalImage.naturalHeight;
			originalCtx.drawImage(this.originalImage, 0, 0);
	
			// Step 1: Apply Rotation and Flipping to the ENTIRE image
			const rotatedCanvas = document.createElement('canvas');
			const rotatedCtx = rotatedCanvas.getContext('2d');
			if (!rotatedCtx) {
				throw new Error('Could not get canvas context for rotation');
			}
	
			// Calculate dimensions after rotation
			rotatedCanvas.width = Math.abs(this.currentRotation) === 90 || Math.abs(this.currentRotation) === 270
				? originalCanvas.height
				: originalCanvas.width;
			rotatedCanvas.height = Math.abs(this.currentRotation) === 90 || Math.abs(this.currentRotation) === 270
				? originalCanvas.width
				: originalCanvas.height;
	
			rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
			rotatedCtx.rotate((this.currentRotation * Math.PI) / 180);
			rotatedCtx.scale(this.isFlippedX ? -1 : 1, this.isFlippedY ? -1 : 1);
			rotatedCtx.drawImage(originalCanvas, -originalCanvas.width / 2, -originalCanvas.height / 2);
	
			// Step 2: Apply Cropping to the Rotated Image
			const finalCanvas = document.createElement('canvas');
			const finalCtx = finalCanvas.getContext('2d');
			if (!finalCtx) {
				throw new Error('Could not get canvas context for cropping');
			}
	
			if (this.selectionArea.style.display !== 'none' && this.selectionArea.offsetWidth) {
				const selectionRect = this.selectionArea.getBoundingClientRect();
				const imageRect = this.originalImage.getBoundingClientRect();
	
				// Calculate the crop region on the *original* image
				const cropLeftOriginal = (selectionRect.left - imageRect.left) * (this.originalImage.naturalWidth / imageRect.width);
				const cropTopOriginal = (selectionRect.top - imageRect.top) * (this.originalImage.naturalHeight / imageRect.height);
				const cropWidthOriginal = selectionRect.width * (this.originalImage.naturalWidth / imageRect.width);
				const cropHeightOriginal = selectionRect.height * (this.originalImage.naturalHeight / imageRect.height);
	
				// Calculate the bounding box of the rotated *crop selection*
				const angleRad = this.currentRotation * Math.PI / 180;
				const corners = [
					{ x: cropLeftOriginal, y: cropTopOriginal },
					{ x: cropLeftOriginal + cropWidthOriginal, y: cropTopOriginal },
					{ x: cropLeftOriginal, y: cropTopOriginal + cropHeightOriginal },
					{ x: cropLeftOriginal + cropWidthOriginal, y: cropTopOriginal + cropHeightOriginal },
				];
	
				const rotatedCorners = corners.map(corner => {
					const relativeX = corner.x - originalCanvas.width / 2;
					const relativeY = corner.y - originalCanvas.height / 2;
					const rotatedX = relativeX * Math.cos(angleRad) - relativeY * Math.sin(angleRad);
					const rotatedY = relativeX * Math.sin(angleRad) + relativeY * Math.cos(angleRad);
					return { x: rotatedX + rotatedCanvas.width / 2, y: rotatedY + rotatedCanvas.height / 2 };
				});
	
				const minX = Math.min(...rotatedCorners.map(corner => corner.x));
				const maxX = Math.max(...rotatedCorners.map(corner => corner.x));
				const minY = Math.min(...rotatedCorners.map(corner => corner.y));
				const maxY = Math.max(...rotatedCorners.map(corner => corner.y));
	
				const cropXRotated = minX;
				const cropYRotated = minY;
				const cropWidthRotated = maxX - minX;
				const cropHeightRotated = maxY - minY;
	
				finalCanvas.width = Math.round(cropWidthRotated);
				finalCanvas.height = Math.round(cropHeightRotated);
	
				// Draw the cropped portion from the rotated canvas
				finalCtx.drawImage(
					rotatedCanvas,
					Math.round(cropXRotated),
					Math.round(cropYRotated),
					Math.round(cropWidthRotated),
					Math.round(cropHeightRotated),
					0,
					0,
					Math.round(cropWidthRotated),
					Math.round(cropHeightRotated)
				);
	
			} else {
				// No cropping, just use the rotated image
				finalCanvas.width = rotatedCanvas.width;
				finalCanvas.height = rotatedCanvas.height;
				finalCtx.drawImage(rotatedCanvas, 0, 0);
			}
	
			// --- Rest of the saveImage function (determining format and saving) ---
			const extension = this.imageFile.extension.toLowerCase();
			let outputFormat: SupportedImageFormat = 'png';
			let quality = 1.0;
	
			switch (extension) {
				case 'jpg':
				case 'jpeg':
					outputFormat = 'jpeg';
					quality = 0.92;
					break;
				case 'webp':
					outputFormat = 'webp';
					quality = 0.92;
					break;
				case 'avif':
					outputFormat = 'avif';
					quality = 0.85;
					break;
				case 'png':
					outputFormat = 'png';
					break;
			}
	
			const blob = await new Promise<Blob>((resolve, reject) => {
				finalCanvas.toBlob(
					(result) => {
						if (result) {
							resolve(result);
						} else {
							reject(new Error('Failed to create blob from canvas'));
						}
					},
					`image/${outputFormat}`,
					quality
				);
			});
	
			if (!blob) {
				throw new Error('Failed to create image blob');
			}
	
			const arrayBuffer = await blob.arrayBuffer();
	
			if (!arrayBuffer) {
				throw new Error('Failed to create array buffer from blob');
			}
	
			await this.app.vault.modifyBinary(this.imageFile, arrayBuffer);
	
			new Notice('Image saved successfully');
	
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) {
				const currentState = leaf.getViewState();
				await leaf.setViewState({
					type: 'empty',
					state: {}
				});
				await leaf.setViewState(currentState);
			}
	
			this.close();
	
		} catch (error) {
			console.error('Save error:', error);
			new Notice(`Error saving image: ${error.message}`);
		}
	}

	// Add these cleanup methods
	onClose() {
		// Clean up URLs
		if (this.originalImage?.src) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		
		// Clean up canvases
		const canvases = this.containerEl.querySelectorAll('canvas');
		canvases.forEach(canvas => {
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
			}
			canvas.width = 0;
			canvas.height = 0;
		});
		
		// Clear references
		// this.originalImage = null;
		this.originalArrayBuffer = null;
		
		// Existing cleanup
		this.componentContainer.unload();
		this.contentEl.empty();
	}
}