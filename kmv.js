// The .kesmovie decoder for web browsers: a port of src/kmv.c (the kernel's decoder), which is bit-exact with the Go reference in tools/kmv.
// Format: docs/KESMOVIE.md in the Kestrel source. Works in a browser (global KMV) and in Node (require / import).
(function (root) {
  "use strict";
  const HDR = 64, MAXW = 1920, MAXH = 1088;

  // ------------------------------------------------------------------ header and index
  function parseHeader(b) {
    if (b.length < HDR || b[0] !== 0x4b || b[1] !== 0x4d || b[2] !== 0x56 || b[3] !== 0x31) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const i = {
      w: dv.getUint16(4, true), h: dv.getUint16(6, true), fpsNum: dv.getUint32(8, true), fpsDen: dv.getUint32(12, true), frames: dv.getUint32(16, true),
      audioRate: dv.getUint32(20, true), channels: b[24], quality: b[25], gop: dv.getUint16(26, true), audioSamples: dv.getUint32(28, true),
      dataOff: dv.getUint32(36, true), durationMs: dv.getUint32(40, true),
    };
    if (dv.getUint32(32, true) !== i.frames || i.w < 16 || i.h < 16 || i.w > MAXW || i.h > MAXH || !i.fpsNum || !i.fpsDen || i.fpsNum > 240 * i.fpsDen) return null;
    if (i.frames === 0 || i.frames > 2000000 || i.dataOff !== HDR + 4 * i.frames) return null;
    if (i.audioRate && (i.channels < 1 || i.channels > 2 || i.audioRate < 8000 || i.audioRate > 96000)) return null;
    return i;
  }

  // ------------------------------------------------------------------ range decoder
  class Rd {
    constructor(b, pos, end) { this.b = b; this.pos = pos; this.end = end; this.rng = 0xFFFFFFFF; this.code = 0; this.next(); for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0; }
    next() { return this.pos < this.end ? this.b[this.pos++] : 0; }
    bit(m, k) {
      const p = m[k];
      const bound = Math.imul(this.rng >>> 11, p) >>> 0;
      let bit;
      if (this.code < bound) { this.rng = bound; m[k] = p + ((2048 - p) >> 5); bit = 0; }
      else { this.code = (this.code - bound) >>> 0; this.rng = (this.rng - bound) >>> 0; m[k] = p - (p >> 5); bit = 1; }
      if (this.rng < 0x1000000) { this.rng = (this.rng << 8) >>> 0; this.code = ((this.code << 8) | this.next()) >>> 0; }
      return bit;
    }
    direct(n) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        this.rng >>>= 1;
        this.code = (this.code - this.rng) >>> 0;
        const t = (0 - (this.code >>> 31)) >>> 0;
        this.code = (this.code + (this.rng & t)) >>> 0;
        v = ((v << 1) + ((t + 1) >>> 0)) >>> 0;
        if (this.rng < 0x1000000) { this.rng = (this.rng << 8) >>> 0; this.code = ((this.code << 8) | this.next()) >>> 0; }
      }
      return v;
    }
  }

  const O_SKIP = 0, O_INTRA = 3, O_MVD = 4, O_CBP = 44, O_DC = 68, O_HASAC = 108, O_SIG = 110, O_LAST = 362, O_B0 = 614, O_BN = 630, O_ESC = 656, N_MODELS = 696;
  const ZIGZAG = Uint8Array.of(0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63);
  const BASE_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const BASE_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];

  function quantTables(q, lu, ch) {
    if (q < 1) q = 1;
    if (q > 100) q = 100;
    const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
    for (let i = 0; i < 64; i++) {
      const a = Math.floor((BASE_LUMA[i] * scale + 50) / 100), b = Math.floor((BASE_CHROMA[i] * scale + 50) / 100);
      lu[i] = a < 1 ? 1 : a > 255 ? 255 : a;
      ch[i] = b < 1 ? 1 : b > 255 ? 255 : b;
    }
  }

  // ------------------------------------------------------------------ integer IDCT (libjpeg "islow")
  const CB = 13, P1 = 2, F0298 = 2446, F0390 = 3196, F0541 = 4433, F0765 = 6270, F0899 = 7373, F1175 = 9633, F1501 = 12299, F1847 = 15137, F1961 = 16069, F2053 = 16819, F2562 = 20995, F3072 = 25172;
  const ws = new Int32Array(64);
  function idct8x8(inp, out) {
    const mul = Math.imul;
    for (let c = 0; c < 8; c++) {
      let z2 = inp[16 + c], z3 = inp[48 + c];
      let z1 = mul((z2 + z3) | 0, F0541);
      let tmp2 = (z1 + mul(z3, -F1847)) | 0, tmp3 = (z1 + mul(z2, F0765)) | 0;
      z2 = inp[c]; z3 = inp[32 + c];
      let tmp0 = (z2 + z3) << CB, tmp1 = (z2 - z3) << CB;
      const tmp10 = (tmp0 + tmp3) | 0, tmp13 = (tmp0 - tmp3) | 0, tmp11 = (tmp1 + tmp2) | 0, tmp12 = (tmp1 - tmp2) | 0;
      tmp0 = inp[56 + c]; tmp1 = inp[40 + c]; tmp2 = inp[24 + c]; tmp3 = inp[8 + c];
      z1 = (tmp0 + tmp3) | 0; z2 = (tmp1 + tmp2) | 0; z3 = (tmp0 + tmp2) | 0;
      let z4 = (tmp1 + tmp3) | 0;
      const z5 = mul((z3 + z4) | 0, F1175);
      tmp0 = mul(tmp0, F0298); tmp1 = mul(tmp1, F2053); tmp2 = mul(tmp2, F3072); tmp3 = mul(tmp3, F1501);
      z1 = mul(z1, -F0899); z2 = mul(z2, -F2562); z3 = mul(z3, -F1961); z4 = mul(z4, -F0390);
      z3 = (z3 + z5) | 0; z4 = (z4 + z5) | 0;
      tmp0 = (tmp0 + z1 + z3) | 0; tmp1 = (tmp1 + z2 + z4) | 0; tmp2 = (tmp2 + z2 + z3) | 0; tmp3 = (tmp3 + z1 + z4) | 0;
      const R = 1 << (CB - P1 - 1), S = CB - P1;
      ws[c] = (tmp10 + tmp3 + R) >> S; ws[56 + c] = (tmp10 - tmp3 + R) >> S;
      ws[8 + c] = (tmp11 + tmp2 + R) >> S; ws[48 + c] = (tmp11 - tmp2 + R) >> S;
      ws[16 + c] = (tmp12 + tmp1 + R) >> S; ws[40 + c] = (tmp12 - tmp1 + R) >> S;
      ws[24 + c] = (tmp13 + tmp0 + R) >> S; ws[32 + c] = (tmp13 - tmp0 + R) >> S;
    }
    for (let r = 0; r < 8; r++) {
      const o = r * 8;
      let z2 = ws[o + 2], z3 = ws[o + 6];
      let z1 = mul((z2 + z3) | 0, F0541);
      let tmp2 = (z1 + mul(z3, -F1847)) | 0, tmp3 = (z1 + mul(z2, F0765)) | 0;
      let tmp0 = (ws[o] + ws[o + 4]) << CB, tmp1 = (ws[o] - ws[o + 4]) << CB;
      const tmp10 = (tmp0 + tmp3) | 0, tmp13 = (tmp0 - tmp3) | 0, tmp11 = (tmp1 + tmp2) | 0, tmp12 = (tmp1 - tmp2) | 0;
      tmp0 = ws[o + 7]; tmp1 = ws[o + 5]; tmp2 = ws[o + 3]; tmp3 = ws[o + 1];
      z1 = (tmp0 + tmp3) | 0; z2 = (tmp1 + tmp2) | 0; z3 = (tmp0 + tmp2) | 0;
      let z4 = (tmp1 + tmp3) | 0;
      const z5 = mul((z3 + z4) | 0, F1175);
      tmp0 = mul(tmp0, F0298); tmp1 = mul(tmp1, F2053); tmp2 = mul(tmp2, F3072); tmp3 = mul(tmp3, F1501);
      z1 = mul(z1, -F0899); z2 = mul(z2, -F2562); z3 = mul(z3, -F1961); z4 = mul(z4, -F0390);
      z3 = (z3 + z5) | 0; z4 = (z4 + z5) | 0;
      tmp0 = (tmp0 + z1 + z3) | 0; tmp1 = (tmp1 + z2 + z4) | 0; tmp2 = (tmp2 + z2 + z3) | 0; tmp3 = (tmp3 + z1 + z4) | 0;
      const R = 1 << (CB + P1 + 3 - 1), S = CB + P1 + 3;
      out[o] = (tmp10 + tmp3 + R) >> S; out[o + 7] = (tmp10 - tmp3 + R) >> S;
      out[o + 1] = (tmp11 + tmp2 + R) >> S; out[o + 6] = (tmp11 - tmp2 + R) >> S;
      out[o + 2] = (tmp12 + tmp1 + R) >> S; out[o + 5] = (tmp12 - tmp1 + R) >> S;
      out[o + 3] = (tmp13 + tmp0 + R) >> S; out[o + 4] = (tmp13 - tmp0 + R) >> S;
    }
  }

  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const median3 = (a, b, c) => { if (a > b) { const t = a; a = b; b = t; } if (b > c) b = c; if (a > b) b = a; return b; };
  const clampmv = (v) => (v < -4000 ? -4000 : v > 4000 ? 4000 : v);

  // ------------------------------------------------------------------ the decoder
  class Decoder {
    constructor(w, h) {
      if (w < 16 || h < 16 || w > MAXW || h > MAXH) throw new Error("bad size");
      this.W = (w + 15) & ~15; this.H = (h + 15) & ~15; this.mbw = this.W / 16; this.mbh = this.H / 16;
      const ys = this.W * this.H, cs = ys / 4;
      this.y = [new Uint8Array(ys), new Uint8Array(ys)]; this.u = [new Uint8Array(cs), new Uint8Array(cs)]; this.v = [new Uint8Array(cs), new Uint8Array(cs)];
      this.cur = 0; this.haveRef = false;
      this.m = new Uint16Array(N_MODELS);
      this.lq = new Int32Array(64); this.cq = new Int32Array(64);
      const n = this.mbw * this.mbh;
      this.mvx = new Int16Array(n); this.mvy = new Int16Array(n); this.skipf = new Uint8Array(n); this.cbps = new Uint8Array(n);
      this.dcpred = [0, 0, 0];
      this.lev = new Int16Array(6 * 64);
      this.dqin = new Int32Array(64); this.res = new Int32Array(64); this.pred = new Uint8Array(256);
    }
    ueg(d, o) {
      let n = 0;
      for (;;) {
        if (!d.bit(this.m, o + (n > 19 ? 19 : n))) break;
        n++;
        if (n >= 30) break;
      }
      return ((1 << n) + d.direct(n) - 1) >>> 0;
    }
    seg(d, o) { const u = this.ueg(d, o); return u & 1 ? Math.floor((u + 1) / 2) : -Math.floor(u / 2); }
    block(d, base, chroma, intra) {
      const m = this.m, lev = this.lev, cl = chroma, start = intra ? 1 : 0;
      if (intra && !d.bit(m, O_HASAC + cl)) return;
      const pos = [];
      const sig = O_SIG + (cl * 2 + intra) * 63, last = O_LAST + (cl * 2 + intra) * 63;
      let finished = false;
      for (let k = start; k < 63; k++) {
        if (!d.bit(m, sig + k)) continue;
        pos.push(k);
        if (d.bit(m, last + k)) { finished = true; break; }
      }
      if (!finished) pos.push(63);
      let eq1 = 0, gt1 = 0;
      for (let j = pos.length - 1; j >= 0; j--) {
        const ctx0 = (eq1 > 3 ? 3 : eq1) + (gt1 > 0 ? 4 : 0);
        let a;
        if (!d.bit(m, O_B0 + cl * 8 + ctx0)) { a = 1; eq1++; }
        else {
          gt1++;
          let t = 2;
          while (t < 15) { if (!d.bit(m, O_BN + cl * 13 + t - 2)) break; t++; }
          if (t === 15) t = 15 + this.ueg(d, O_ESC + cl * 20);
          a = t;
        }
        lev[base + pos[j]] = d.direct(1) ? -a : a;
      }
    }
    mvPred(x, y) {
      let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
      const i = y * this.mbw + x, w = this.mbw;
      if (x > 0) { ax = this.mvx[i - 1]; ay = this.mvy[i - 1]; }
      if (y > 0) {
        bx = this.mvx[i - w]; by = this.mvy[i - w];
        if (x < w - 1) { cx = this.mvx[i - w + 1]; cy = this.mvy[i - w + 1]; }
        else if (x > 0) { cx = this.mvx[i - w - 1]; cy = this.mvy[i - w - 1]; }
      }
      return [median3(ax, bx, cx), median3(ay, by, cy)];
    }
    // returns the macroblock: {typ, mvx, mvy, cbp}; its levels are in this.lev
    mb(d, x, y, intraFrame) {
      const i = y * this.mbw + x, m = this.m;
      let typ;
      if (!intraFrame) {
        const ctx = (x > 0 && this.skipf[i - 1] ? 1 : 0) + (y > 0 && this.skipf[i - this.mbw] ? 1 : 0);
        if (d.bit(m, O_SKIP + ctx)) typ = 0; else typ = d.bit(m, O_INTRA) ? 2 : 1;
      } else typ = 2;
      const [px, py] = this.mvPred(x, y);
      if (typ === 0) { this.skipf[i] = 1; this.mvx[i] = px; this.mvy[i] = py; this.cbps[i] = 0; return { typ, mvx: px, mvy: py, cbp: 0 }; }
      if (typ === 1) {
        const dx = this.seg(d, O_MVD), dy = this.seg(d, O_MVD + 20);
        const mvx = clampmv(px + dx), mvy = clampmv(py + dy);
        this.mvx[i] = mvx; this.mvy[i] = mvy;
        let cb = 0;
        for (let b = 0; b < 6; b++) {
          let ctx = b;
          if (x > 0 && ((this.cbps[i - 1] >> b) & 1)) ctx += 6;
          if (y > 0 && ((this.cbps[i - this.mbw] >> b) & 1)) ctx += 12;
          cb |= d.bit(m, O_CBP + ctx) << b;
        }
        this.cbps[i] = cb;
        for (let b = 0; b < 6; b++) if ((cb >> b) & 1) this.block(d, b * 64, b >= 4 ? 1 : 0, 0);
        return { typ, mvx, mvy, cbp: cb };
      }
      this.mvx[i] = 0; this.mvy[i] = 0; this.cbps[i] = 0x3F;
      for (let b = 0; b < 6; b++) {
        const comp = b >= 4 ? b - 3 : 0, cls = b >= 4 ? 1 : 0;
        const dd = this.seg(d, O_DC + cls * 20);
        const v = ((dd + this.dcpred[comp]) << 16) >> 16;
        this.lev[b * 64] = v; this.dcpred[comp] = v;
        this.block(d, b * 64, cls, 1);
      }
      return { typ, mvx: 0, mvy: 0, cbp: 0x3F };
    }
    dequant(base, q, out) {
      const inp = this.dqin, lev = this.lev;
      inp.fill(0);
      let anyAc = false;
      for (let k = 0; k < 64; k++) {
        const l = lev[base + k];
        if (l) { inp[ZIGZAG[k]] = Math.imul(l, q[ZIGZAG[k]]); if (k) anyAc = true; }
      }
      if (!anyAc) { const v = (inp[0] + 4) >> 3; out.fill(v); return; }
      idct8x8(inp, out);
    }
    static predict(p, pw, ph, bx, by, size, mvx, mvy, dst) {
      const ix = bx + (mvx >> 1), fx = mvx & 1, iy = by + (mvy >> 1), fy = mvy & 1;
      const at = (x, y) => p[(y < 0 ? 0 : y >= ph ? ph - 1 : y) * pw + (x < 0 ? 0 : x >= pw ? pw - 1 : x)];
      if (ix >= 0 && iy >= 0 && ix + size + 1 <= pw && iy + size + 1 <= ph) {
        for (let r = 0; r < size; r++) {
          const s = (iy + r) * pw + ix, s2 = s + pw, o = r * size;
          if (!fx && !fy) for (let c = 0; c < size; c++) dst[o + c] = p[s + c];
          else if (fx && !fy) for (let c = 0; c < size; c++) dst[o + c] = (p[s + c] + p[s + c + 1] + 1) >> 1;
          else if (!fx) for (let c = 0; c < size; c++) dst[o + c] = (p[s + c] + p[s2 + c] + 1) >> 1;
          else for (let c = 0; c < size; c++) dst[o + c] = (p[s + c] + p[s + c + 1] + p[s2 + c] + p[s2 + c + 1] + 2) >> 2;
        }
        return;
      }
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const x = ix + c, y = iy + r;
        let v;
        if (!fx && !fy) v = at(x, y);
        else if (fx && !fy) v = (at(x, y) + at(x + 1, y) + 1) >> 1;
        else if (!fx) v = (at(x, y) + at(x, y + 1) + 1) >> 1;
        else v = (at(x, y) + at(x + 1, y) + at(x, y + 1) + at(x + 1, y + 1) + 2) >> 2;
        dst[r * size + c] = v;
      }
    }
    recon(x, y, mb) {
      const cu = this.cur, rf = 1 - cu, W = this.W, H = this.H, cw = W / 2;
      const planes = [this.y[cu], this.u[cu], this.v[cu]], res = this.res;
      const place = (b, add) => {
        let dst, stride, bx, by, q;
        if (b < 4) { dst = planes[0]; stride = W; bx = x * 16 + (b & 1) * 8; by = y * 16 + (b >> 1) * 8; q = this.lq; }
        else { dst = planes[b - 3]; stride = cw; bx = x * 8; by = y * 8; q = this.cq; }
        this.dequant(b * 64, q, res);
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
          const o = (by + j) * stride + bx + i;
          dst[o] = clamp8(add ? dst[o] + res[j * 8 + i] : res[j * 8 + i] + 128);
        }
      };
      if (mb.typ === 2) { for (let b = 0; b < 6; b++) place(b, false); return; }
      const pred = this.pred;
      Decoder.predict(this.y[rf], W, H, x * 16, y * 16, 16, mb.mvx, mb.mvy, pred);
      for (let j = 0; j < 16; j++) planes[0].set(pred.subarray(j * 16, j * 16 + 16), (y * 16 + j) * W + x * 16);
      const cmx = mb.mvx >> 1, cmy = mb.mvy >> 1, rp = [this.u[rf], this.v[rf]];
      for (let pl = 0; pl < 2; pl++) {
        Decoder.predict(rp[pl], cw, H / 2, x * 8, y * 8, 8, cmx, cmy, pred);
        for (let j = 0; j < 8; j++) planes[1 + pl].set(pred.subarray(j * 8, j * 8 + 8), (y * 8 + j) * cw + x * 8);
      }
      if (mb.typ === 1) for (let b = 0; b < 6; b++) if ((mb.cbp >> b) & 1) place(b, true);
    }
    // Decode one video payload. Returns {y, u, v, w, h} (coded size; valid until the next call) or null for bad data.
    decode(payload) {
      if (payload.length < 6) return null;
      const intra = payload[0] === 0;
      if (payload[0] > 1) return null;
      if (!intra && !this.haveRef) return null;
      if (intra) { this.m.fill(1024); this.haveRef = false; }
      quantTables(payload[1], this.lq, this.cq);
      this.dcpred = [0, 0, 0];
      this.skipf.fill(0); this.cbps.fill(0); this.mvx.fill(0); this.mvy.fill(0);
      const d = new Rd(payload, 2, payload.length);
      for (let y = 0; y < this.mbh; y++) for (let x = 0; x < this.mbw; x++) {
        this.lev.fill(0);
        const mb = this.mb(d, x, y, intra);
        this.recon(x, y, mb);
      }
      const pic = { y: this.y[this.cur], u: this.u[this.cur], v: this.v[this.cur], w: this.W, h: this.H };
      this.cur = 1 - this.cur; this.haveRef = true;
      return pic;
    }
  }

  // Picture -> RGBA bytes for the visible w x h (BT.601 full range).
  function toRGBA(pic, w, h, out) {
    const cw = pic.w >> 1;
    let o = 0;
    for (let y = 0; y < h; y++) {
      const yo = y * pic.w, co = (y >> 1) * cw;
      for (let x = 0; x < w; x++) {
        const yy = pic.y[yo + x], cb = pic.u[co + (x >> 1)] - 128, cr = pic.v[co + (x >> 1)] - 128;
        out[o++] = clamp8(yy + ((359 * cr) >> 8));
        out[o++] = clamp8(yy - ((88 * cb + 183 * cr) >> 8));
        out[o++] = clamp8(yy + ((454 * cb) >> 8));
        out[o++] = 255;
      }
    }
  }

  // ------------------------------------------------------------------ audio (IMA ADPCM)
  const STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
    157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
    2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
    18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const IDX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
  // interleaved Int16Array, or null on error
  function decodeAudio(p, ch) {
    if (p.length < 2 || ch < 1 || ch > 2) return null;
    const cnt = p[0] | (p[1] << 8);
    if (!cnt) return null;
    const out = new Int16Array(cnt * ch), nb = cnt >> 1;
    let off = 2;
    for (let c = 0; c < ch; c++) {
      if (off + 4 + nb > p.length) return null;
      let pred = ((p[off] | (p[off + 1] << 8)) << 16) >> 16, idx = p[off + 2];
      if (idx > 88) return null;
      off += 4;
      out[c] = pred;
      for (let i = 1; i < cnt; i++) {
        const b = p[off + ((i - 1) >> 1)];
        const code = (i - 1) & 1 ? b >> 4 : b & 15;
        const step = STEP[idx];
        let diff = step >> 3;
        if (code & 4) diff += step;
        if (code & 2) diff += step >> 1;
        if (code & 1) diff += step >> 2;
        pred += code & 8 ? -diff : diff;
        if (pred > 32767) pred = 32767; else if (pred < -32768) pred = -32768;
        idx += IDX[code];
        if (idx < 0) idx = 0; else if (idx > 88) idx = 88;
        out[i * ch + c] = pred;
      }
      off += nb;
    }
    return out;
  }

  // ------------------------------------------------------------------ the file: index and chunks (the data may still be arriving)
  class Movie {
    // buf: a Uint8Array with at least the header and the index; `have` says how many bytes of the file are present (it can grow)
    constructor(buf) {
      this.info = parseHeader(buf);
      if (!this.info) throw new Error("not a .kesmovie file");
      this.buf = buf; this.have = buf.length;
      const n = this.info.frames, dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      this.offsets = new Uint32Array(n); this.keys = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const v = dv.getUint32(HDR + 4 * i, true); this.keys[i] = v >>> 31; this.offsets[i] = v & 0x7FFFFFFF; }
    }
    // the chunk of frame i if all of it is present: {video, audio}; null if not yet downloaded
    chunk(i) {
      const o = this.offsets[i];
      if (o + 8 > this.have) return null;
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const vs = dv.getUint32(o, true), as = dv.getUint32(o + 4, true);
      if (o + 8 + vs + as > this.have) return null;
      return { video: this.buf.subarray(o + 8, o + 8 + vs), audio: this.buf.subarray(o + 8 + vs, o + 8 + vs + as) };
    }
    keyBefore(i) { while (i > 0 && !this.keys[i]) i--; return i; }
    audioStart(i) { return Math.floor(i * this.info.audioRate * this.info.fpsDen / this.info.fpsNum); }
  }

  const KMV = { parseHeader, Decoder, Movie, toRGBA, decodeAudio, HDR };
  if (typeof module !== "undefined" && module.exports) module.exports = KMV; else root.KMV = KMV;
})(typeof globalThis !== "undefined" ? globalThis : this);
