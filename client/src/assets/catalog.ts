/** IDs are scoped to one asset kind. The same definition is shared by all callers. */
export class AssetCatalog<T> {
  private readonly entries = new Map<string, T>();

  constructor(
    private readonly kind: string,
    entries: Iterable<readonly [string, T]>
  ) {
    for (const [id, asset] of entries) {
      if (this.entries.has(id)) throw new Error(`Duplicate ${kind} asset "${id}".`);
      this.entries.set(id, asset);
    }
  }

  get(id: string): T {
    if (!this.entries.has(id)) throw new Error(`Unknown ${this.kind} asset "${id}".`);
    return this.entries.get(id)!;
  }

  ids(): IterableIterator<string> {
    return this.entries.keys();
  }
}
