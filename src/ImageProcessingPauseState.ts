/** Tracks the one-shot request to preserve the next pasted image. */
export class ImageProcessingPauseState {
    private skipNextPaste = false;

    armSkipNextPaste(): void {
        this.skipNextPaste = true;
    }

    consumeSkipNextPaste(): boolean {
        if (!this.skipNextPaste) return false;
        this.skipNextPaste = false;
        return true;
    }
}
