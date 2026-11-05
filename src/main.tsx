import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/atmosphere.css";
import "./styles/header.css";
import "./styles/segmented.css";
import "./styles/match-tile.css";
import "./styles/home.css";
import "./styles/sport-page.css";
import "./styles/match-modal.css";
import "./styles/bracket.css";
import "./styles/admin.css";
import "./styles/footer.css";
import "./styles/states.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
