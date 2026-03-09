import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PresageProvider } from "./context/PresageContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PresageProvider>
      <App />
    </PresageProvider>
  </React.StrictMode>
);
