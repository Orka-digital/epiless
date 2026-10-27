typedef unsigned char u8;
typedef signed char i8;
typedef unsigned short u16;
typedef unsigned int u32;

// wasm32 pointer layout; the adapter supplies live typed-array views of exactly
// these buffers. No state is copied into/out of this kernel for each frame.
typedef struct {
  u32 *input;
  double *times;
  double *linear;
  double *constants;
  u16 *gstarts;
  u8 *gcount;
  u8 *gnext;
  u8 *gactive;
  u32 *gseeds;
  u16 *rstarts;
  u16 *rprevious;
  u16 *rtriple;
  u16 *rcandidate;
  u8 *ractive;
  u32 *rseeds;
  double *luminance;
  i8 *direction;
  u32 *anchor;
  u8 *saturated;
  u8 *pending;
  double *du;
  double *dv;
  u16 *redstart;
  u32 *previous_rgb;
  u32 *representatives;
} State;
_Static_assert(sizeof(void *) == 4, "The ABI requires wasm32 pointers");
_Static_assert(sizeof(State) == 100, "State must contain exactly 25 wasm32 pointers");
_Static_assert(sizeof(u16) == 2 && sizeof(u32) == 4 && sizeof(double) == 8,
               "The ABI requires exact integer/Float64 widths");

__attribute__((export_name("kernel_abi_version")))
u32 kernel_abi_version(void) { return 2; }
__attribute__((export_name("kernel_state_size")))
u32 kernel_state_size(void) { return sizeof(State); }

static void reset_red(State *s, u32 p) {
  for (u32 n = 0; n < 3; n++) {
    s->rstarts[p * 3 + n] = 0;
    s->rprevious[p * 3 + n] = 0;
  }
  s->rtriple[p] = 0;
  s->rcandidate[p] = 0;
}

static void general_transition(State *s, u32 p, double current, u32 frame,
                               u32 *out) {
  double anchor = s->luminance[p];
  if (!__builtin_isfinite(anchor)) {
    s->luminance[p] = current;
    return;
  }
  double delta = current - anchor;
  i8 direction = s->direction[p];
  int sign = (delta > 0) - (delta < 0);
  if (direction && sign == direction) {
    s->luminance[p] = current;
    return;
  }
  if (__builtin_fabs(delta) + s->constants[0] < 0.1 ||
      (current < anchor ? current : anchor) >= 0.8)
    return;
  u32 next = s->gnext[p];
  s->gstarts[p * 7 + next] = frame;
  next = (next + 1) % 7;
  s->gnext[p] = next;
  u8 count = s->gcount[p];
  if (count < 7) count++;
  s->gcount[p] = count;
  if (count == 7 &&
      s->times[frame] - s->times[s->gstarts[p * 7 + next]] < s->constants[2]) {
    s->gactive[p] = 1;
    if (out[0] < 256) s->gseeds[out[0]] = p;
    out[0]++;
  }
  s->direction[p] = delta > 0 ? 1 : -1;
  s->luminance[p] = current;
}

static void chromaticity(State *s, u32 rgb, double *u, double *v) {
  double r = s->linear[rgb & 255];
  double g = s->linear[(rgb >> 8) & 255];
  double b = s->linear[(rgb >> 16) & 255];
  double x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  double y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  double z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  double d = x + 15 * y + 3 * z;
  *u = (4 * x) / d;
  *v = (9 * y) / d;
}

static void red_transition(State *s, u32 p, u32 rgb, u8 saturated,
                           u32 frame, u32 *out) {
  double u, v, old_u, old_v;
  chromaticity(s, rgb, &u, &v);
  chromaticity(s, s->anchor[p], &old_u, &old_v);
  double du = u - old_u;
  double dv = v - old_v;
  if (du * du + dv * dv <= s->constants[1]) return;
  int opposing = s->pending[p] != 0 && du * s->du[p] + dv * s->dv[p] < 0;
  u32 offset = p * 3;
  u16 triple = s->rtriple[p];
  s->rtriple[p] = opposing ? s->rprevious[offset + 1] : 0;
  if (opposing && s->times[frame] - s->times[triple] < s->constants[2]) {
    s->ractive[p] = 1;
    if (out[1] < 256) s->rseeds[out[1]] = p;
    out[1]++;
    s->rcandidate[p] = triple;
  }
  for (int pairs = 2; pairs >= 0; pairs--) {
    u16 old = s->rstarts[offset + pairs];
    if (opposing) {
      u16 start = pairs == 0 ? s->redstart[p] : s->rprevious[offset + pairs - 1];
      s->rstarts[offset + pairs] = old > start ? old : start;
    }
    s->rprevious[offset + pairs] = old;
  }
  s->pending[p] = 1;
  s->du[p] = du;
  s->dv[p] = dv;
  s->redstart[p] = frame;
  s->anchor[p] = rgb;
  s->saturated[p] = saturated;
}

__attribute__((export_name("process_dense")))
void process_dense(State *s, u32 pixels, u32 frame, u32 *out) {
  out[0] = out[1] = out[2] = 0;
  for (u32 p = 0; p < pixels; p++) {
    // JS prepareTiles has already materialized any diverging histories. Alias
    // pixels retain their untouched state and are expanded only by JS afterward.
    if (s->representatives[p] != p) continue;
    u32 word = s->input[p];
    if ((word >> 24) != 255) {
      out[2] = 1;
      s->luminance[p] = __builtin_nan("");
      s->anchor[p] = 0xffffffffu;
      s->direction[p] = 0;
      s->pending[p] = 0;
      s->previous_rgb[p] = 0xffffffffu;
      s->gcount[p] = 0;
      reset_red(s, p);
      continue;
    }
    u32 rgb = word & 0xffffffu;
    if (s->previous_rgb[p] == rgb) continue;
    s->previous_rgb[p] = rgb;
    double r = s->linear[rgb & 255];
    double g = s->linear[(rgb >> 8) & 255];
    double b = s->linear[(rgb >> 16) & 255];
    general_transition(s, p, 0.2126 * r + 0.7152 * g + 0.0722 * b, frame, out);
    if (rgb == 0) {
      s->anchor[p] = 0xffffffffu;
      s->pending[p] = 0;
      reset_red(s, p);
    } else {
      u8 saturated = r / (r + g + b) >= 0.8;
      if (s->anchor[p] == 0xffffffffu) {
        s->anchor[p] = rgb;
        s->saturated[p] = saturated;
      } else if (saturated || s->saturated[p]) {
        red_transition(s, p, rgb, saturated, frame, out);
      }
    }
  }
}
