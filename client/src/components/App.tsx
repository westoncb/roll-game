import { Editor } from "./editor/Editor";
import { Game } from "./Game";

export function App() {
  if (location.pathname.replace(/\/$/, "") === "/editor") return <Editor />;
  return (
    <>
      <Game />
      <a href="/editor" className="open-editor">
        Level editor
      </a>
    </>
  );
}
