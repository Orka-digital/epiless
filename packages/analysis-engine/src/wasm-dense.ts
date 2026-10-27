import { linear } from './color-cache.js';
import { DENSE_KERNEL_BYTES } from './dense-kernel.generated.js';

export const EMBEDDED_KERNEL_BYTES = DENSE_KERNEL_BYTES.byteLength;
const PAGE = 65536;
const MAX_STATE = 256 * 1024 * 1024;
const types = {
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  f64: Float64Array,
};
type ArrayView =
  Uint8Array | Int8Array | Uint16Array | Uint32Array | Float64Array;
type Spec = [string, keyof typeof types, number, boolean];
type KernelExports = {
  process_dense: (
    state: number,
    pixels: number,
    frame: number,
    out: number,
  ) => void;
  __heap_base: WebAssembly.Global;
  kernel_abi_version: () => number;
  kernel_state_size: () => number;
};
let compiled: WebAssembly.Module | undefined;

function instantiate(
  module: WebAssembly.Module,
  memory: WebAssembly.Memory,
): KernelExports {
  const exports = new WebAssembly.Instance(module, { env: { memory } })
    .exports as unknown as KernelExports;
  if (exports.kernel_abi_version() !== 2 || exports.kernel_state_size() !== 100)
    throw new Error('Unsupported WASM dense-kernel ABI');
  return exports;
}

/** Fixed temporal state shared by the exact JS and dense WASM routes. The input
 * allocation is additional; temporal arrays are moved, never duplicated per frame.
 * Compilation/initialization can fail before capture and select JS instead. */
export class WasmDenseArena {
  readonly views: Record<string, ArrayView> = {};
  readonly pixels: number;
  readonly migratedStateBytes: number;
  readonly extraAllocatedBytes: number;
  readonly memoryBytes: number;
  readonly inputRgba: Uint8ClampedArray;
  readonly report: Readonly<Record<string, number>>;
  readonly #memory: WebAssembly.Memory;
  readonly #exports: KernelExports;
  lastTiming = { inputCopyMs: 0, kernelMs: 0, copiedInputBytes: 0 };

  constructor(
    readonly width: number,
    readonly height: number,
    availableBytes = MAX_STATE,
  ) {
    this.pixels = width * height;
    // Lazy, guarded by the analyzer. No browser or CLI performs compilation just
    // by importing this module. A failed initialization never enters a frame loop.
    compiled ??= new WebAssembly.Module(DENSE_KERNEL_BYTES);
    // Read the actual linker heap boundary before creating live views. This
    // short-lived 128 KiB probe is initialization overhead, not retained state.
    const probe = instantiate(
      compiled,
      new WebAssembly.Memory({ initial: 2, maximum: 2 }),
    );
    const heapBase = Number(probe.__heap_base.value);
    if (!Number.isInteger(heapBase) || heapBase < 0)
      throw new Error('Invalid linker heap base');
    const n = this.pixels;
    // Exact State C pointer order, followed by call-result storage.
    const specs: Spec[] = [
      ['input', 'u32', n, false],
      ['times', 'f64', 65536, true],
      ['linear', 'f64', 256, false],
      ['constants', 'f64', 3, false],
      ['gstarts', 'u16', n * 7, true],
      ['gcount', 'u8', n, true],
      ['gnext', 'u8', n, true],
      ['gactive', 'u8', n, true],
      ['gseeds', 'u32', 256, true],
      ['rstarts', 'u16', n * 3, true],
      ['rprevious', 'u16', n * 3, true],
      ['rtriple', 'u16', n, true],
      ['rcandidate', 'u16', n, true],
      ['ractive', 'u8', n, true],
      ['rseeds', 'u32', 256, true],
      ['luminance', 'f64', n, true],
      ['direction', 'i8', n, true],
      ['anchor', 'u32', n, true],
      ['saturated', 'u8', n, true],
      ['pending', 'u8', n, true],
      ['du', 'f64', n, true],
      ['dv', 'f64', n, true],
      ['redstart', 'u16', n, true],
      ['previous_rgb', 'u32', n, true],
      ['representatives', 'u32', n, true],
      ['pointers', 'u32', 25, false],
      ['out', 'u32', 3, false],
    ];
    let offset = heapBase,
      migrated = 0,
      alignment = 0;
    const layouts = specs.map(([name, kind, count, state]) => {
      const bytes = types[kind].BYTES_PER_ELEMENT;
      const aligned = Math.ceil(offset / bytes) * bytes;
      alignment += aligned - offset;
      offset = aligned + count * bytes;
      if (state) migrated += count * bytes;
      return { name, kind, count, offset: aligned };
    });
    const pages = Math.ceil(offset / PAGE);
    if (pages * PAGE > Math.min(availableBytes, MAX_STATE))
      throw new Error('WASM temporal allocation exceeds retained-state budget');
    // Final memory can never grow and detach a converter's live input view.
    this.#memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
    this.#exports = instantiate(compiled, this.#memory);
    if (Number(this.#exports.__heap_base.value) !== heapBase)
      throw new Error('WASM linker heap boundary changed');
    for (const entry of layouts) {
      const Type = types[entry.kind];
      this.views[entry.name] = new Type(
        this.#memory.buffer,
        entry.offset,
        entry.count,
      );
    }
    this.inputRgba = new Uint8ClampedArray(
      this.#memory.buffer,
      this.views.input.byteOffset,
      n * 4,
    );
    const pointers = this.views.pointers as Uint32Array;
    layouts.slice(0, 25).forEach((entry, index) => {
      pointers[index] = entry.offset;
    });
    (this.views.linear as Float64Array).set(linear);
    (this.views.constants as Float64Array).set([
      Number.EPSILON,
      0.2 ** 2,
      1000 - 1e-6,
    ]);
    this.migratedStateBytes = migrated;
    this.memoryBytes = this.#memory.buffer.byteLength;
    this.extraAllocatedBytes = this.memoryBytes - migrated;
    this.report = Object.freeze({
      migratedStateBytes: migrated,
      memoryBytes: this.memoryBytes,
      extraAllocatedBytes: this.extraAllocatedBytes,
      inputBytes: n * 4,
      linearTableBytes: 256 * 8,
      constantsBytes: 24,
      pointerAndResultBytes: 112,
      linkerStackAndStaticBytes: heapBase,
      alignmentBytes: alignment,
      pageRoundingBytes: pages * PAGE - offset,
      pages,
    });
    this.reset();
  }

  reset(): void {
    for (const [name, view] of Object.entries(this.views)) {
      // The input may be the accepted frame about to be processed after an epoch
      // reset. Keep timestamp tails too, as the original engine does.
      if (['input', 'times', 'linear', 'constants', 'pointers'].includes(name))
        continue;
      view.fill(0);
    }
    (this.views.times as Float64Array)[0] = -Infinity;
    this.views.luminance.fill(NaN);
    this.views.anchor.fill(0xffffffff);
    this.views.previous_rgb.fill(0xffffffff);
  }

  process(words: Uint32Array, frame: number): Uint32Array {
    const input = this.views.input as Uint32Array;
    if (words.length !== this.pixels || this.#memory.buffer !== input.buffer)
      throw new Error('Dense input geometry or memory identity mismatch');
    const start = performance.now();
    const direct =
      words.buffer === input.buffer && words.byteOffset === input.byteOffset;
    if (!direct) input.set(words);
    const copied = performance.now();
    const out = this.views.out as Uint32Array;
    this.#exports.process_dense(
      this.views.pointers.byteOffset,
      this.pixels,
      frame,
      out.byteOffset,
    );
    const end = performance.now();
    this.lastTiming = {
      inputCopyMs: copied - start,
      kernelMs: end - copied,
      copiedInputBytes: direct ? 0 : words.byteLength,
    };
    return out;
  }
}
