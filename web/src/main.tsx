/// <reference types="vite/client" />

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/saira-condensed/400.css";
import "@fontsource/saira-condensed/500.css";
import "@fontsource/saira-condensed/600.css";
import "@fontsource/saira-condensed/700.css";
import "@fontsource/spline-sans-mono/400.css";
import "@fontsource/spline-sans-mono/500.css";
import "@fontsource/spline-sans-mono/600.css";
import "@fontsource/fraunces/700.css";

import "./styles/theme.css";
import "./styles/app.css";
import "./styles/shell.css";

import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
