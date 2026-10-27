import { captureDimensions } from './capture-quality';

/** Convert in the worker. Native frames use an explicit tightly packed sRGB RGBA
 * copy, avoiding a full-size CPU canvas redraw. Rotation/display scaling and
 * oversized captures use the browser's colour-managed canvas path. */
export class FrameConverter {
  private buffer: Uint8ClampedArray = new Uint8ClampedArray(0);
  private externalInput = false;
  private canvas: OffscreenCanvas | undefined;
  private context: OffscreenCanvasRenderingContext2D | null = null;
  private copyUnsupported = false;

  prepare(
    sourceWidth: number,
    sourceHeight: number,
    input?: Uint8ClampedArray,
  ): void {
    const { width, height } = captureDimensions(sourceWidth, sourceHeight);
    if (input) {
      if (input.length !== width * height * 4 || input.byteOffset % 4 !== 0)
        throw new Error(
          'Analysis input buffer does not match capture geometry',
        );
      this.buffer = input;
      this.externalInput = true;
    } else if (
      this.externalInput ||
      this.buffer.length !== width * height * 4
    ) {
      this.buffer = new Uint8ClampedArray(width * height * 4);
      this.externalInput = false;
    }
  }

  releaseInput(): void {
    this.buffer = new Uint8ClampedArray(0);
    this.externalInput = false;
  }

  async convert(
    frame: VideoFrame,
    sourceWidth: number,
    sourceHeight: number,
    input?: Uint8ClampedArray,
  ) {
    const { width, height } = captureDimensions(sourceWidth, sourceHeight);
    const rect = frame.visibleRect;
    const transform = frame as VideoFrame & {
      rotation?: number;
      flip?: boolean;
    };
    if (
      !this.copyUnsupported &&
      width === sourceWidth &&
      height === sourceHeight &&
      rect?.width === width &&
      rect.height === height &&
      !transform.rotation &&
      !transform.flip
    ) {
      // The analyzer owns this stable view. Native copyTo writes directly into
      // its arena; the dense kernel does not need a second full-frame copy.
      this.prepare(sourceWidth, sourceHeight, input);
      try {
        await frame.copyTo(this.buffer, {
          format: 'RGBA',
          colorSpace: 'srgb',
          rect: { x: rect.x, y: rect.y, width, height },
          layout: [{ offset: 0, stride: width * 4 }],
        });
        return {
          rgba: this.buffer,
          width,
          height,
          method: 'VIDEOFRAME_COPY_RGBA' as const,
        };
      } catch (error) {
        if (
          !(error instanceof TypeError) &&
          !(error instanceof DOMException && error.name === 'NotSupportedError')
        )
          throw error;
        // Older implementations may lack explicit RGBA conversion. Use the
        // colour-managed fallback; never reinterpret native YUV/BGRA as RGBA.
        this.copyUnsupported = true;
      }
    }
    // Canvas owns a separate readback. Do not keep a previous arena alive when
    // analysis replaces it for new geometry on this fallback path.
    this.releaseInput();
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(width, height);
      // Repeated software conversion of a 6K source was measured at ~150ms/frame.
      // Explicit false retains hardware drawing for the unavoidable resize path.
      this.context = this.canvas.getContext('2d', {
        willReadFrequently: false,
        colorSpace: 'srgb',
      });
    }
    if (!this.context) throw new Error('Worker pixel canvas is unavailable');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context.drawImage(frame, 0, 0, width, height);
    return {
      rgba: this.context.getImageData(0, 0, width, height).data,
      width,
      height,
      method: 'CANVAS2D_SRGB' as const,
    };
  }
}
