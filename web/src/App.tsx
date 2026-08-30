import { BrowserRouter } from "react-router";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
