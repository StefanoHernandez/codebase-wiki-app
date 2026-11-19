import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { NavProvider } from "./state/nav";
import { ProjectProvider } from "./state/project";
import { RagProvider } from "./state/rag";
import { UpdatesProvider } from "./state/updates";
import { LangKeyed, LangProvider } from "./state/lang";

export default function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <ProjectProvider>
          <RagProvider>
            <NavProvider>
              <UpdatesProvider>
                <LangKeyed>
                  <ErrorBoundary>
                    <Shell />
                  </ErrorBoundary>
                </LangKeyed>
              </UpdatesProvider>
            </NavProvider>
          </RagProvider>
        </ProjectProvider>
      </ToastProvider>
    </LangProvider>
  );
}
