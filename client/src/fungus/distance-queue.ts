// Nearest-first visits for both gem distances and the advancing wound front.
export class DistanceQueue<T> {
  private readonly entries: { value: T; distance: number }[] = [];

  add(value: T, distance: number) {
    const entries = this.entries;
    let i = entries.length;
    const entry = { value, distance };
    entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entries[parent].distance <= distance) break;
      entries[i] = entries[parent];
      i = parent;
    }
    entries[i] = entry;
  }

  take(limit = Infinity) {
    const entries = this.entries;
    const first = entries[0];
    if (!first || first.distance > limit) return;
    const last = entries.pop()!;
    if (entries.length) {
      let i = 0;
      while (2 * i + 1 < entries.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < entries.length &&
          entries[child + 1].distance < entries[child].distance
        )
          child++;
        if (entries[child].distance >= last.distance) break;
        entries[i] = entries[child];
        i = child;
      }
      entries[i] = last;
    }
    return first;
  }

  get size() {
    return this.entries.length;
  }
}
