import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticleEffect } from "../../engine/particles/emitter";
import { readParticleEffect } from "../../assets/particle-effect";
import { Parameters } from "./Parameters";
import { Preview } from "./Preview";

export function ParticleEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ParticleEffect | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastFixedSeed = useRef(0);
  function setSeed(fixedSeed: number | undefined) {
    if (
      fixedSeed !== undefined &&
      Number.isInteger(fixedSeed) &&
      fixedSeed >= 0 &&
      fixedSeed <= 0xffffffff
    )
      lastFixedSeed.current = fixedSeed;
    setError("");
    setDraft((current) => current && { ...current, fixedSeed });
  }
  const path = "/api/particles/" + encodeURIComponent(id);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const controller = new AbortController();
    async function load() {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok)
        throw new Error("Could not load " + id + " (HTTP " + response.status + ").");
      const effect = readParticleEffect(await response.json(), id);
      if (!controller.signal.aborted) {
        lastFixedSeed.current = effect.fixedSeed ?? 0;
        setDraft(effect);
      }
    }
    load().catch((cause) => {
      if (!controller.signal.aborted) setError(String(cause.message ?? cause));
    });
    return () => {
      controller.abort();
      el.close();
    };
  }, [path, id]);
  const invalid = useMemo(() => {
    if (draft)
      try {
        readParticleEffect({ version: 1, ...draft }, id);
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    return "";
  }, [draft, id]);
  async function save() {
    if (!draft || invalid || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, ...draft })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? "Save failed (HTTP " + response.status + ").");
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }
  const emitter = draft?.emitters[selected];
  return (
    <dialog
      ref={dialog}
      className="particle-dialog"
      aria-labelledby="particle-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
    >
      <header className="particle-heading">
        <span>Particle editor</span>
        <h2 id="particle-title">{id}</h2>
      </header>
      <Preview effect={invalid ? null : draft} />
      <section className="parameter-scroll" aria-label="Particle effect parameters">
        {draft ? (
          <>
            <fieldset disabled={saving} className="parameter-fields effect-settings">
              <legend>Effect settings</legend>
              <label className="param">
                Randomness
                <select
                  value={draft.fixedSeed === undefined ? "random" : "fixed"}
                  onChange={(e) =>
                    setSeed(e.target.value === "fixed" ? lastFixedSeed.current : undefined)
                  }
                >
                  <option value="random">Random each time</option>
                  <option value="fixed">Fixed seed</option>
                </select>
              </label>
              {draft.fixedSeed !== undefined && (
                <label className="param">
                  Seed
                  <input
                    type="number"
                    min={0}
                    max={0xffffffff}
                    step={1}
                    value={Number.isFinite(draft.fixedSeed) ? draft.fixedSeed : ""}
                    onChange={(e) => setSeed(e.currentTarget.valueAsNumber)}
                  />
                </label>
              )}
            </fieldset>
            <div className="parameter-heading">
              <h3>Emitter parameters</h3>
              <label>
                Emitter{" "}
                <select
                  value={selected}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {draft.emitters.map((e, i) => (
                    <option key={i} value={i}>
                      {i + 1} · {e.emission.kind}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {emitter && (
              <fieldset disabled={saving} className="parameter-fields">
                <Parameters
                  emitter={emitter}
                  change={(next) => {
                    setError("");
                    setDraft({
                      ...draft,
                      emitters: draft.emitters.map((old, i) =>
                        i === selected ? next : old
                      )
                    });
                  }}
                />
              </fieldset>
            )}
          </>
        ) : (
          !error && <p>Loading asset…</p>
        )}
      </section>
      <footer>
        {(error || invalid) && <span role="alert">{error || invalid}</span>}
        <button disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!draft || !!invalid || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </dialog>
  );
}
