// Harness entry — see surfacetest.html. Mounts SurfaceEditor on the demo
// fixture (empty content → /surface-proto/demo.json) outside AuthGate, so the
// pan clamp and zoom stops can be exercised by hand without a session and
// without writing to anyone's vault: opening a node is not an edit, and the
// harness's onChange only logs.
import { createRoot } from "react-dom/client";
import { SurfaceEditor } from "./components/surface/SurfaceEditor";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <SurfaceEditor
      nodeId="__surfacetest__"
      name="Surface harness"
      content=""
      onChange={(next) => console.log("[surfacetest] onChange", next.length, "chars")}
    />
  </div>,
);
