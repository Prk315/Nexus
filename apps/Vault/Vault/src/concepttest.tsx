// Harness entry for ConceptPanel — see concepttest.html. Injects a dozen real
// extracted PGM items through the `load` prop, so rendering, search, filter
// and zoom are all testable without a session.
import { createRoot } from "react-dom/client";
import { ConceptPanel } from "./components/ConceptPanel";
import sample from "./conceptSample.json";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <div style={{ width: 420, height: "100vh", display: "flex", flexDirection: "column",
    borderRight: "1px solid #ccc", font: "13px sans-serif" }}>
    <ConceptPanel nodeId="__test__" load={async () => JSON.stringify(sample)} />
  </div>,
);
