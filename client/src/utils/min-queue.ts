/** A binary min-heap. take(limit) leaves the next item queued if its priority exceeds the limit. */
export class MinQueue<T> {
  private readonly entries: { value: T; priority: number }[] = [];

  add(value: T, priority: number) {
    const entries = this.entries;
    let i = entries.length;
    const entry = { value, priority };
    entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entries[parent].priority <= priority) break;
      entries[i] = entries[parent];
      i = parent;
    }
    entries[i] = entry;
  }

  take(limit = Infinity) {
    const entries = this.entries;
    const first = entries[0];
    if (!first || first.priority > limit) return;
    const last = entries.pop()!;
    if (entries.length) {
      let i = 0;
      while (2 * i + 1 < entries.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < entries.length &&
          entries[child + 1].priority < entries[child].priority
        )
          child++;
        if (entries[child].priority >= last.priority) break;
        entries[i] = entries[child];
        i = child;
      }
      entries[i] = last;
    }
    return first;
  }
}
