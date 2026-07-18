import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AuthProvider } from "./auth/AuthProvider";
import { NotificationPreferencesProvider } from "./alerts/notificationPreferences";
import { PaperAccountProvider } from "./orders/PaperAccountProvider";
import { ChartTradeHistoryProvider } from "./orders/ChartTradeHistoryProvider";
import { AiCoachRuntimeProvider } from "./components/ai-coach/AiCoachRuntimeProvider";
import { syncChartEngineThemeFromCss } from "./theme/colors";
import "./styles.css";
import "./chart-features.css";

syncChartEngineThemeFromCss();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <PaperAccountProvider>
          <AiCoachRuntimeProvider>
            <ChartTradeHistoryProvider>
              <NotificationPreferencesProvider>
                <App />
              </NotificationPreferencesProvider>
            </ChartTradeHistoryProvider>
          </AiCoachRuntimeProvider>
        </PaperAccountProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>
);
