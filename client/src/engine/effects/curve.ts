/** The owner supplies normalized progress, e.g. over one animation or one particle. */
export type Curve<T> = (progress: number) => T;
type Key<T> = { readonly at: number; readonly value: T };

/** Keys are in increasing order over normalized lifetime, with constant end values. */
export type Keyframes<T> = readonly [Key<T>, ...Key<T>[]];

export function sampleKeyframes<T>(
  track: Keyframes<T>,
  t: number,
  mix: (a: T, b: T, fraction: number) => T
): T {
  let left = track[0];
  if (t <= left.at) return left.value;
  for (let i = 1; i < track.length; i++) {
    const right = track[i];
    if (t < right.at)
      return mix(left.value, right.value, (t - left.at) / (right.at - left.at));
    left = right;
  }
  return left.value;
}
