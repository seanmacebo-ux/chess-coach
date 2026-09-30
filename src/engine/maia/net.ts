/**
 * Maia (lc0 net) weight loader — the TS port of the numpy reference verified
 * against lc0 this session. Parses an lc0 `pblczero.Net` protobuf (already
 * gunzipped) into Float32Array tensors, with batch-norm folded into the conv
 * weights so the forward pass is plain conv + bias.
 *
 * BN folding (from lc0 network_legacy.cc):
 *   bn_stddivs holds VARIANCE, not std.
 *   s     = gamma / sqrt(var + 1e-5)
 *   mean' = mean - conv_bias
 *   w'    = w * s              (per output channel)
 *   bias' = beta - s * mean'
 */

const EPS = 1e-5

export interface Conv {
  w: Float32Array // [outC, inC, k, k], output-major
  b: Float32Array // [outC]
  outC: number
  inC: number
  k: number
}

export interface SE {
  w1: Float32Array // [seC, C]
  b1: Float32Array // [seC]
  w2: Float32Array // [2C, seC]
  b2: Float32Array // [2C]
  seC: number
}

export interface Residual {
  c1: Conv
  c2: Conv
  se: SE | null
}

export interface MaiaNet {
  filters: number
  blocks: number
  polPlanes: number
  input: Conv
  residuals: Residual[]
  policy1: Conv
  policy: Conv
  valueConv: Conv
  ip1: { w: Float32Array; b: Float32Array } // [128, 2048]
  ip2: { w: Float32Array; b: Float32Array } // [3, 128]
}

/* ------------------------------------------------------------------ */
/* minimal protobuf reader                                             */
/* ------------------------------------------------------------------ */

type Field = { wire: number; start: number; end: number }
type Fields = Map<number, Field[]>

function parse(buf: Uint8Array, from = 0, to = buf.length): Fields {
  const out: Fields = new Map()
  let i = from
  const readVarint = (): number => {
    let shift = 0
    let val = 0
    for (;;) {
      if (i >= buf.length) throw new Error('maia net: varint runs past end of buffer')
      const b = buf[i++]!
      val += (b & 0x7f) * Math.pow(2, shift)
      if (!(b & 0x80)) break
      shift += 7
    }
    return val
  }
  while (i < to) {
    const key = readVarint()
    const field = Math.floor(key / 8)
    const wire = key & 7
    let f: Field
    if (wire === 0) {
      const s = i
      readVarint()
      f = { wire, start: s, end: i }
    } else if (wire === 2) {
      const len = readVarint()
      if (len < 0 || i + len > to) throw new Error('maia net: field length exceeds bounds')
      f = { wire, start: i, end: i + len }
      i += len
    } else if (wire === 5) {
      f = { wire, start: i, end: i + 4 }
      i += 4
    } else if (wire === 1) {
      f = { wire, start: i, end: i + 8 }
      i += 8
    } else {
      throw new Error(`bad wire type ${wire} at ${i}`)
    }
    const arr = out.get(field)
    if (arr) arr.push(f)
    else out.set(field, [f])
  }
  return out
}

const f = (m: Fields, n: number): Field => {
  const a = m.get(n)
  if (!a || !a[0]) throw new Error(`missing field ${n}`)
  return a[0]
}
const has = (m: Fields, n: number) => m.has(n)

/** A quantized lc0 Layer message -> dequantized Float32Array. */
function layer(buf: Uint8Array, fld: Field): Float32Array {
  const L = parse(buf, fld.start, fld.end)
  const dv = new DataView(buf.buffer, buf.byteOffset)
  const mn = has(L, 1) ? dv.getFloat32(f(L, 1).start, true) : 0
  const mx = has(L, 2) ? dv.getFloat32(f(L, 2).start, true) : 0
  if (!has(L, 3)) return new Float32Array(0)
  const p = f(L, 3)
  const n = (p.end - p.start) / 2
  const out = new Float32Array(n)
  const scale = (mx - mn) / 65535
  for (let k = 0; k < n; k++) {
    const q = dv.getUint16(p.start + k * 2, true)
    out[k] = mn + scale * q
  }
  return out
}

/** ConvBlock -> Conv with BN folded in. */
function foldConv(buf: Uint8Array, fld: Field, outC: number, inC: number, k: number): Conv {
  const cb = parse(buf, fld.start, fld.end)
  const w = layer(buf, f(cb, 1))
  const bias = has(cb, 2) ? layer(buf, f(cb, 2)) : new Float32Array(outC)
  if (has(cb, 3)) {
    const mean = layer(buf, f(cb, 3))
    const varr = layer(buf, f(cb, 4)) // "stddivs" = variance
    const gamma = has(cb, 5) && layer(buf, f(cb, 5)).length ? layer(buf, f(cb, 5)) : ones(outC)
    const beta = has(cb, 6) && layer(buf, f(cb, 6)).length ? layer(buf, f(cb, 6)) : new Float32Array(outC)
    const b = new Float32Array(outC)
    const per = inC * k * k
    for (let o = 0; o < outC; o++) {
      const s = gamma[o]! / Math.sqrt(varr[o]! + EPS)
      for (let j = 0; j < per; j++) w[o * per + j] = w[o * per + j]! * s
      b[o] = beta[o]! - s * (mean[o]! - bias[o]!)
    }
    return { w, b, outC, inC, k }
  }
  return { w, b: bias, outC, inC, k }
}

function ones(n: number): Float32Array {
  const a = new Float32Array(n)
  a.fill(1)
  return a
}

/** Parse a gunzipped lc0 net protobuf into a MaiaNet. */
export function loadMaiaNet(bytes: Uint8Array): MaiaNet {
  const net = parse(bytes)
  const wFld = f(net, 10)
  const W = parse(bytes, wFld.start, wFld.end)

  // input block: FILT filters, 112 input planes. bn_means length = out channels.
  const inpCb = parse(bytes, f(W, 1).start, f(W, 1).end)
  const FILT = layer(bytes, f(inpCb, 3)).length
  const input = foldConv(bytes, f(W, 1), FILT, 112, 3)

  const residuals: Residual[] = []
  for (const r of W.get(2) ?? []) {
    const rb = parse(bytes, r.start, r.end)
    const c1 = foldConv(bytes, f(rb, 1), FILT, FILT, 3)
    const c2 = foldConv(bytes, f(rb, 2), FILT, FILT, 3)
    let se: SE | null = null
    if (has(rb, 3)) {
      const s = parse(bytes, f(rb, 3).start, f(rb, 3).end)
      const w1 = layer(bytes, f(s, 1))
      se = { w1, b1: layer(bytes, f(s, 2)), w2: layer(bytes, f(s, 3)), b2: layer(bytes, f(s, 4)), seC: w1.length / FILT }
    }
    residuals.push({ c1, c2, se })
  }

  const policy1 = foldConv(bytes, f(W, 11), FILT, FILT, 3)
  // final policy conv: no BN, out channels = bias length
  const pcb = parse(bytes, f(W, 3).start, f(W, 3).end)
  const polBias = layer(bytes, f(pcb, 2))
  const polPlanes = polBias.length
  const policy: Conv = { w: layer(bytes, f(pcb, 1)), b: polBias, outC: polPlanes, inC: FILT, k: 3 }

  // value head: 1x1 conv (BN) -> dense 2048->128 -> dense 128->3 (WDL)
  const vcb = parse(bytes, f(W, 6).start, f(W, 6).end)
  const valPlanes = layer(bytes, f(vcb, 3)).length
  const valueConv = foldConv(bytes, f(W, 6), valPlanes, FILT, 1)
  const ip1 = { w: layer(bytes, f(W, 7)), b: layer(bytes, f(W, 8)) }
  const ip2 = { w: layer(bytes, f(W, 9)), b: layer(bytes, f(W, 10)) }

  return { filters: FILT, blocks: residuals.length, polPlanes, input, residuals, policy1, policy, valueConv, ip1, ip2 }
}
