import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AuthProvider } from "./auth/AuthProvider";
import { NotificationPreferencesProvider } from "./alerts/notificationPreferences";
import { PaperAccountProvider } from "./orders/PaperAccountProvider";
import { syncChartEngineThemeFromCss } from "./theme/colors";
import "./styles.css";
import "./chart-features.css";

syncChartEngineThemeFromCss();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <PaperAccountProvider>
          <NotificationPreferencesProvider>
            <App />
          </NotificationPreferencesProvider>
        </PaperAccountProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>
);
