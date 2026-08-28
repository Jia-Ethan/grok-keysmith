import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./globals.css";
import "./i18n";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
