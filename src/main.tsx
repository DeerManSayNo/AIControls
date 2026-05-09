import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import FloatBallApp from "./FloatBallApp";
import { I18nProvider } from "./i18n/provider";
import "./styles.css";

const currentWindow = getCurrentWindow();
const isFloatBallWindow = currentWindow.label === "float-ball";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isFloatBallWindow ? (
      <FloatBallApp />
    ) : (
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    )}
  </StrictMode>,
);
