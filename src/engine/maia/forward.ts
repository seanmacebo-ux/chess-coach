/**
 * Maia forward pass (TS port of the numpy reference verified vs lc0 this session).
 *
 * FEN -> 112-plane input (lc0 INPUT_CLASSICAL_112_PLANE, fen_only history fill)
 *     -> input conv (BN+relu)
 *     -> N x [conv1(relu) -> conv2 -> SE -> +skip -> relu]
 *     -> policy: policy1(relu) -> policy conv -> gather CONV_POLICY_MAP -> 1858 -> temp softmax
 *     -> value:  1x1 conv(relu) -> dense128(relu) -> dense3 -> WDL softmax
 *
 * Verified: startpos + mid-game (black to move) match lc0 to the decimal.
 * Non-null assertions on typed-array reads: indices are always in range in
 * these fixed-size numeric loops (repo runs noUncheckedIndexedAccess).
 */
import { Chess } from 'chess.js'
import type { MaiaNet, Conv, SE } from './net'
import { CONV_POLICY_MAP, POLICY_MOVES } from './data'

const POLICY_TEMP = 1.359 // lc0 default PolicyTemperature
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

const MOVE_TO_IDX = new Map<string, number>()
POLICY_MOVES.forEach((m, i) => MOVE_TO_IDX.set(m, i))

const PIECE_IDX: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 }

export interface MaiaResult {
  ranked: { uci: string; p: number }[] // legal moves, prob desc
  wdl: [number, number, number]
}

/* ------------------------------------------------------------------ encoding */

function sqIndex(square: string): number {
  const file = square.charCodeAt(0) - 97 // a..h -> 0..7
  const rank = square.charCodeAt(1) - 49 // 1..8 -> 0..7
  return rank * 8 + file
}

function sqName(i: number): string {
  return String.fromCharCode(97 + (i % 8)) + String.fromCharCode(49 + Math.floor(i / 8))
}

/** FEN -> [112,8,8] planes (flat, plane*64 + square), plus board + side flag. */
function encode(fen: string): { planes: Float32Array; board: Chess; black: boolean } {
  const board = new Chess(fen)
  const black = board.turn() === 'b'
  const planes = new Float32Array(112 * 64)
  const placement = fen.split(' ')[0]
  const isStartpos = placement === STARTPOS && !black
  const nHist = isStartpos ? 1 : 8

  const stm = black ? 'b' : 'w'
  for (let s0 = 0; s0 < 64; s0++) {
    const pc = board.get(sqName(s0) as never) as { type: string; color: string } | undefined
    if (!pc) continue
    const ours = pc.color === stm
    const planeInFrame = (ours ? 0 : 6) + (PIECE_IDX[pc.type] ?? 0)
    const s = black ? s0 ^ 56 : s0 // flip rank for black perspective
    for (let frame = 0; frame < nHist; frame++) {
      planes[(frame * 13 + planeInFrame) * 64 + s] = 1
    }
  }

  const wc = board.getCastlingRights(stm)
  const tc = board.getCastlingRights(black ? 'w' : 'b')
  const fillPlane = (p: number, v: number) => planes.fill(v, p * 64, p * 64 + 64)
  if (wc.q) fillPlane(104, 1)
  if (wc.k) fillPlane(105, 1)
  if (tc.q) fillPlane(106, 1)
  if (tc.k) fillPlane(107, 1)
  if (black) fillPlane(108, 1)
  fillPlane(109, parseInt(fen.split(' ')[4] || '0', 10)) // rule50
  fillPlane(111, 1)
  return { planes, board, black }
}

/* ------------------------------------------------------------------ layers */

function conv(x: Float32Array, cIn: number, c: Conv, pad: number): Float32Array {
  const { w, b, outC, k } = c
  const out = new Float32Array(outC * 64)
  const per = cIn * k * k
  for (let o = 0; o < outC; o++) {
    const wo = o * per
    const bias = b[o]!
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        let sum = bias
        for (let i = 0; i < cIn; i++) {
          const xi = i * 64
          const wi = wo + i * k * k
          for (let dy = 0; dy < k; dy++) {
            const yy = row + dy - pad
            if (yy < 0 || yy > 7) continue
            for (let dx = 0; dx < k; dx++) {
              const xx = col + dx - pad
              if (xx < 0 || xx > 7) continue
              sum += w[wi + dy * k + dx]! * x[xi + yy * 8 + xx]!
            }
          }
        }
        out[o * 64 + row * 8 + col] = sum
      }
    }
  }
  return out
}

function reluInPlace(x: Float32Array): Float32Array {
  for (let i = 0; i < x.length; i++) if (x[i]! < 0) x[i] = 0
  return x
}

function applySE(x: Float32Array, C: number, se: SE): void {
  const z = new Float32Array(C)
  for (let c = 0; c < C; c++) {
    let s = 0
    for (let k = 0; k < 64; k++) s += x[c * 64 + k]!
    z[c] = s / 64
  }
  const a = new Float32Array(se.seC)
  for (let j = 0; j < se.seC; j++) {
    let s = se.b1[j]!
    for (let c = 0; c < C; c++) s += se.w1[j * C + c]! * z[c]!
    a[j] = s > 0 ? s : 0
  }
  const y = new Float32Array(2 * C)
  for (let o = 0; o < 2 * C; o++) {
    let s = se.b2[o]!
    for (let j = 0; j < se.seC; j++) s += se.w2[o * se.seC + j]! * a[j]!
    y[o] = s
  }
  for (let c = 0; c < C; c++) {
    const scale = 1 / (1 + Math.exp(-y[c]!))
    const shift = y[C + c]!
    for (let k = 0; k < 64; k++) x[c * 64 + k] = x[c * 64 + k]! * scale + shift
  }
}

function trunk(net: MaiaNet, planes: Float32Array): Float32Array {
  const F = net.filters
  let x = reluInPlace(conv(planes, 112, net.input, 1))
  for (const r of net.residuals) {
    const t1 = reluInPlace(conv(x, F, r.c1, 1))
    const t2 = conv(t1, F, r.c2, 1)
    if (r.se) applySE(t2, F, r.se)
    for (let i = 0; i < x.length; i++) {
      const v = t2[i]! + x[i]!
      t2[i] = v > 0 ? v : 0
    }
    x = t2
  }
  return x
}

/* ------------------------------------------------------------------ heads + API */

function moveKey(from: string, to: string, promo: string | undefined, black: boolean): string {
  let f = sqIndex(from)
  let t = sqIndex(to)
  if (black) {
    f ^= 56
    t ^= 56
  }
  let key = sqName(f) + sqName(t)
  if (promo && promo !== 'n') key += promo // knight promo reuses the plain-move slot
  return key
}

export function maiaForward(net: MaiaNet, fen: string): MaiaResult {
  const { planes, board, black } = encode(fen)
  const x = trunk(net, planes)
  const F = net.filters

  // policy
  const p = reluInPlace(conv(x, F, net.policy1, 1))
  const pc = conv(p, F, net.policy, 1)
  const logits = new Float32Array(1858).fill(-1e9)
  for (let j = 0; j < CONV_POLICY_MAP.length; j++) {
    const idx = CONV_POLICY_MAP[j]!
    if (idx >= 0) logits[idx] = pc[j]!
  }

  // value (WDL)
  const v = reluInPlace(conv(x, F, net.valueConv, 0))
  const h = new Float32Array(128)
  for (let o = 0; o < 128; o++) {
    let s = net.ip1.b[o]!
    for (let i = 0; i < v.length; i++) s += net.ip1.w[o * v.length + i]! * v[i]!
    h[o] = s > 0 ? s : 0
  }
  const raw = new Float32Array(3)
  for (let o = 0; o < 3; o++) {
    let s = net.ip2.b[o]!
    for (let i = 0; i < 128; i++) s += net.ip2.w[o * 128 + i]! * h[i]!
    raw[o] = s
  }
  const wmax = Math.max(raw[0]!, raw[1]!, raw[2]!)
  const we = Math.exp(raw[0]! - wmax)
  const de = Math.exp(raw[1]! - wmax)
  const le = Math.exp(raw[2]! - wmax)
  const wsum = we + de + le
  const wdl: [number, number, number] = [we / wsum, de / wsum, le / wsum]

  // legal-move policy with temperature
  const legal = board.moves({ verbose: true })
  const lg = legal.map((m) => {
    const i = MOVE_TO_IDX.get(moveKey(m.from, m.to, m.promotion, black))
    return i === undefined ? -1e9 : logits[i]!
  })
  const lmax = Math.max(...lg)
  const ex = lg.map((val) => Math.exp((val - lmax) / POLICY_TEMP))
  const sum = ex.reduce((acc, val) => acc + val, 0)
  const ranked = legal
    .map((m, i) => ({ uci: m.from + m.to + (m.promotion ?? ''), p: ex[i]! / sum }))
    .sort((a, b) => b.p - a.p)

  return { ranked, wdl }
}
