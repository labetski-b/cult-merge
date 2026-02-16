export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  nextId(): string {
    const a = (this.next() * 0xffffffff) >>> 0;
    const b = (this.next() * 0xffffffff) >>> 0;
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
  }

  getState(): number {
    return this.state;
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
