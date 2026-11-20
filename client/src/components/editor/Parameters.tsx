import type { Emitter } from "../../engine/particles/emitter";

const names: Record<string, string> = {
  pass: "Draw pass",
  space: "Simulation space",
  offset: "Spawn offset",
  segment: "Spawn segment",
  direction: "Direction (rad)",
  speed: "Speed",
  acceleration: "Acceleration",
  drag: "Drag",
  lifetime: "Lifetime (s)",
  delay: "Delay (s)",
  radius: "Radius",
  stretch: "Stretch",
  rotation: "Rotation (rad)",
  angularSpeed: "Angular speed",
  sizeOverLife: "Size over life",
  colorOverLife: "Color over life",
  opacityOverLife: "Opacity over life",
  blend: "Blend",
  count: "Burst count",
  perSecond: "Particles per second",
  duration: "Duration (s)"
};
const choices: Record<string, string[]> = {
  pass: ["behind", "front"],
  space: ["world", "local"],
  blend: ["normal", "additive"]
};
function Numeric({
  name,
  value,
  change
}: {
  name: string;
  value: number;
  change: (v: number) => void;
}) {
  return (
    <input
      type="number"
      aria-label={name}
      value={Number.isFinite(value) ? value : ""}
      step="any"
      onChange={(e) => change(e.currentTarget.valueAsNumber)}
    />
  );
}
type KeyValue = { at: number; value: number | string };
function Field({
  field,
  value,
  change
}: {
  field: string;
  value: unknown;
  change: (v: unknown) => void;
}) {
  const name = names[field] ?? field;
  let input;
  if (choices[field])
    input = (
      <select
        aria-label={name}
        value={String(value)}
        onChange={(e) => change(e.target.value)}
      >
        {choices[field].map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    );
  else if (typeof value === "number")
    input = <Numeric name={name} value={value} change={change} />;
  else if (typeof value === "string")
    input = (
      <div className="field-values">
        {/^#[\da-f]{6}$/i.test(value) && (
          <input
            type="color"
            aria-label={name + " picker"}
            value={value}
            onChange={(e) => change(e.target.value)}
          />
        )}
        <input
          type="text"
          aria-label={name}
          value={value}
          onChange={(e) => change(e.target.value)}
        />
      </div>
    );
  else if (Array.isArray(value) && typeof value[0] === "number") {
    const labels = ["offset", "segment", "acceleration"].includes(field)
      ? ["X", "Y"]
      : ["Min", "Max"];
    input = (
      <div className="field-values">
        {value.map((n, i) => (
          <label key={i}>
            {labels[i]}
            <Numeric
              name={name + " " + labels[i]}
              value={n}
              change={(next) => change(value.map((v, j) => (j === i ? next : v)))}
            />
          </label>
        ))}
      </div>
    );
  } else if (Array.isArray(value)) {
    const keys = value as KeyValue[];
    const update = (i: number, patch: Partial<KeyValue>) =>
      change(keys.map((k, j) => (j === i ? { ...k, ...patch } : k)));
    input = (
      <div>
        {keys.map((k, i) => (
          <div className="field-values" key={i}>
            <label>
              Time
              <Numeric
                name={name + " key " + (i + 1) + " time"}
                value={k.at}
                change={(at) => update(i, { at })}
              />
            </label>
            <label>
              Value
              {typeof k.value === "number" ? (
                <Numeric
                  name={name + " key " + (i + 1) + " value"}
                  value={k.value}
                  change={(value) => update(i, { value })}
                />
              ) : (
                <input
                  value={k.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              )}
            </label>
          </div>
        ))}
      </div>
    );
  } else return null;
  return (
    <div className="param">
      <span>{name}</span>
      {input}
    </div>
  );
}

export function Parameters({
  emitter,
  change
}: {
  emitter: Emitter;
  change: (e: Emitter) => void;
}) {
  const { emission, strength, ...properties } = emitter;
  return (
    <>
      {Object.entries(emission)
        .filter(([k]) => k !== "kind")
        .map(([k, v]) => (
          <Field
            key={k}
            field={k}
            value={v}
            change={(value) =>
              change({ ...emitter, emission: { ...emission, [k]: value } })
            }
          />
        ))}
      {Object.entries({
        space: "world",
        pass: "front",
        blend: "normal",
        ...properties
      }).map(([k, v]) => (
        <Field
          key={k}
          field={k}
          value={v}
          change={(value) => change({ ...emitter, [k]: value })}
        />
      ))}
      {strength && (
        <fieldset>
          <legend>Strength multipliers</legend>
          {Object.entries(strength).map(([k, v]) => (
            <div className="param" key={k}>
              <span>{k}</span>
              <div className="field-values">
                {v.map((n, i) => (
                  <label key={i}>
                    At {i}
                    <Numeric
                      name={k + " at strength " + i}
                      value={n}
                      change={(next) =>
                        change({
                          ...emitter,
                          strength: {
                            ...strength,
                            [k]: v.map((val, j) => (j === i ? next : val))
                          }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}
    </>
  );
}
