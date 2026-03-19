import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PlaygroundProvider } from "./hooks/usePlayground";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlaygroundProvider>
      <App />
    </PlaygroundProvider>
  </React.StrictMode>
);
