export class MetricBuffer {
  constructor(capacity = 300) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.head = 0;
    this.count = 0;
  }

  push(value) {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getValues() {
    if (this.count === 0) return [];

    const out = new Array(this.count);
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.data[(start + i) % this.capacity];
    }
    return out;
  }

  getMinMax() {
    if (this.count === 0) return { min: 0, max: 0 };

    let min = Infinity;
    let max = -Infinity;
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const v = this.data[(start + i) % this.capacity];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }
}
