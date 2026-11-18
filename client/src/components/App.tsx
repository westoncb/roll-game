import { useState } from "react";
import { Game } from "./Game";

enum AppState {
  Game = "game",
  Editor = "editor"
}

export function App() {
  let [state, setState] = useState<AppState>(AppState.Game);

  switch (state) {
    case AppState.Game:
      return <Game />;
    case AppState.Editor:
      return <div>editor</div>;
  }
}
