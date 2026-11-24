type Scalar = string | number | boolean | bigint | symbol | null | undefined;

// A mapped type preserves named record fields, arrays, and tuple positions.
type Snapshot<Data> = Data extends Scalar
  ? Data
  : Data extends Function
    ? never
    : Data extends object
      ? { readonly [Key in keyof Data]: Snapshot<Data[Key]> }
      : never;

/** Games declare a data object for each string kind. Runtime capture checks plain
 * prototypes and cycles, which TypeScript's structural types cannot express. */
type EventMap<Events> = {
  [Kind in keyof Events]-?: Kind extends string ? object & Snapshot<Events[Kind]> : never;
};
type EventKind<Events> = keyof Events & string;

/** One recorded occurrence. Checking its kind narrows its data to that kind's payload. */
export type GameEvent<Events extends EventMap<Events>> = {
  [Kind in EventKind<Events>]: {
    readonly kind: Kind;
    /** Absolute simulation time in seconds. */
    readonly time: number;
    readonly data: Snapshot<Events[Kind]>;
  };
}[EventKind<Events>];

export interface TickEvents<Events extends EventMap<Events>> {
  readonly start: number;
  readonly end: number;
  readonly events: readonly GameEvent<Events>[];
}

/** Each valid call pairs a kind with its own payload. */
export type EmitEvent<Events extends EventMap<Events>> = (
  ...args: {
    [Kind in EventKind<Events>]: [kind: Kind, data: Snapshot<Events[Kind]>, time?: number];
  }[EventKind<Events>]
) => void;

/** Run one synchronous simulation tick and publish its facts in emission order.
 * Times are absolute simulation seconds. An occurrence defaults to the tick boundary.
 * Each emit captures its payload as acyclic plain records, arrays, and scalar values.
 * Use coordinate tuples for positions and stable IDs for live objects.
 * Each reader can iterate the same batch, including after a later tick is recorded.
 * @example
 * type Events = { moved: { id: string; position: readonly [number, number] } };
 * const tick = recordTickEvents<Events>(0, 1, emit => {
 *   emit("moved", { id: "a", position: [2, 3] });
 * });
 */
export function recordTickEvents<Events extends EventMap<Events>>(
  start: number,
  end: number,
  simulate: (emit: EmitEvent<Events>) => void
): TickEvents<Events> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new RangeError("A tick needs a finite, increasing time interval.");
  const events: GameEvent<Events>[] = [];
  let open = true;
  try {
    simulate((...args) => {
      const [kind, data, time = end] = args;
      if (!open) throw new Error("This tick has ended.");
      if (typeof kind !== "string" || data === null || typeof data !== "object")
        throw new TypeError("An event needs a string kind and a data object.");
      if (!Number.isFinite(time) || time < start || time > end)
        throw new RangeError("Event time must be within the tick.");
      // The emission signature pairs kind and data before we capture them.
      events.push(
        Object.freeze({ kind, time, data: snapshot(data, new Set()) }) as GameEvent<Events>
      );
    });
  } finally {
    open = false;
  }
  return Object.freeze({ start, end, events: Object.freeze(events) });
}

function snapshot(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function"))
    return value;
  if (ancestors.has(value)) throw new TypeError("Event data must be acyclic.");
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    copy = value.map((item) => snapshot(item, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError(
        "Use plain event data, coordinate tuples, and IDs for live objects."
      );
    const record = value as Record<PropertyKey, unknown>;
    copy = Object.fromEntries(
      Reflect.ownKeys(record).map((key) => [key, snapshot(record[key], ancestors)])
    );
  }
  ancestors.delete(value);
  return Object.freeze(copy);
}
