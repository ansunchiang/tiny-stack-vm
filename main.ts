import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// Opcode nibbles select a row and column. Subtract ASCII '0' to recover
// the packed layout: immediate width, then two bits each for pushes and pops.
const formats = ['0Dt19:>?', '666666656665666', '666', 'PQQP0', '52', '1141']

const alu: ((a: number, b: number) => number)[] = [
  (a, b) => a + b, (a, b) => a - b, Math.imul,
  (a, b) => a / b, (a, b) => a % b,
  (a, b) => (a >>> 0) / (b >>> 0), (a, b) => (a >>> 0) % (b >>> 0),
  a => -a, (a, b) => a & b, (a, b) => a | b, (a, b) => a ^ b, a => ~a,
  (a, b) => a << b, (a, b) => a >> b, (a, b) => a >>> b,
  , // 0x1f has no instruction.
  (a, b) => +(a === b), (a, b) => +(a < b), (a, b) => +((a >>> 0) < (b >>> 0)),
]

export function run(program: Buffer, input: Buffer) {
  const stack = new Int32Array(256)
  const memory = new Int32Array(256)
  const returns = new Int32Array(64)
  const output = Buffer.alloc(65536)
  let written = 0

  function execute() {
    let pc = 0, depth = 0, calls = 0, read = 0
    for (let step = 0; step < 1_000_000; step++) {
      const op = program[pc++]
      if (op === undefined) return 9
      const char = formats[op >> 4]?.charCodeAt(op & 15)
      if (!char) return 5
      const form = char - 48
      const arg = pc
      pc += form >> 4
      if (pc > program.length) return 9

      const base = depth - (form & 3)
      if (base < 0) return 2
      depth = base + ((form >> 2) & 3)
      if (depth > 256) return 3
      const a = stack[base], b = stack[base + 1]
      if (op >= 0x13 && op <= 0x16 && b === 0) return 4

      // Assignment to the stack truncates and wraps arithmetic to signed i32.
      let value = a
      switch (op) {
        case 0: return 0
        case 1: value = program.readInt8(arg); break
        case 2: value = program.readInt32LE(arg); break
        case 3: break
        case 4:
        case 6:
          stack[depth - 1] = a
          continue
        case 5:
          stack[base + 1] = a
          value = b
          break
        case 7:
          stack[base + 1] = stack[base + 2]
          stack[base + 2] = a
          value = b
          break
        case 0x30:
        case 0x31:
        case 0x32:
          if (op === 0x30 || (op === 0x31) === (a === 0)) pc += program.readInt16LE(arg)
          break
        case 0x33:
          if (calls === returns.length) return 7
          returns[calls++] = pc
          pc = program.readUInt16LE(arg)
          break
        case 0x34:
          if (!calls) return 8
          pc = returns[--calls]
          break
        case 0x40:
          if ((a >>> 0) >= memory.length) return 6
          value = memory[a]
          break
        case 0x41:
          if ((b >>> 0) >= memory.length) return 6
          memory[b] = a
          break
        case 0x50:
        case 0x51:
          const text = op === 0x50 ? String(a) : String.fromCharCode(a & 255)
          if (written + text.length > output.length) return 11
          written += output.write(text, written, 'latin1')
          break
        case 0x52: value = input[read++] ?? -1; break
        case 0x53: return a & 255
        default: value = alu[op - 0x10](a, b)
      }
      if (depth > base) stack[base] = value
    }
    return 10
  }

  const exit = execute()
  return { stdout: output.subarray(0, written), exit }
}

if (import.meta.main) {
  const input = process.env.MAKEFUN_INPUT_DIR ?? '/input'
  const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output'
  for (let n = 1; n <= 40; n++) {
    const id = 'i0' + String(n).padStart(2, '0')
    const source = `${input}/${id}`
    const target = `${output}/${id}`
    const result = run(readFileSync(source + '/program.bin'), readFileSync(source + '/input.bin'))
    mkdirSync(target, { recursive: true })
    writeFileSync(target + '/stdout.bin', result.stdout)
    writeFileSync(target + '/exit.txt', String(result.exit))
  }
}
