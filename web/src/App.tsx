import { RouterProvider } from "./router/router.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export function App() {
  return (
    <RouterProvider>
      <AppShell />
    </RouterProvider>
  );
}
