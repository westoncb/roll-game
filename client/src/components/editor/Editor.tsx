import { useState } from "react";
import { gameAssets } from "../../assets";
import { ParticleEditor } from "./ParticleEditor";
import "./editor.css";

export function Editor() {
  const ids = Array.from(gameAssets.particles.ids());
  const [id, setId] = useState(ids[0]);
  const [open, setOpen] = useState(false);
  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Level editor</h1>
        <a href="/">Return to game ↗</a>
      </header>
      <aside className="editor-sidebar">
        <h2>Asset editors</h2>
        {ids.length > 1 && (
          <label>
            Particle asset
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {ids.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
        )}
        <button disabled={!id} onClick={() => setOpen(true)}>
          Particle effects
        </button>
      </aside>
      <section className="level-workspace" aria-label="Empty level">
        <div className="level-frame" />
      </section>
      {open && <ParticleEditor id={id} onClose={() => setOpen(false)} />}
    </main>
  );
}
