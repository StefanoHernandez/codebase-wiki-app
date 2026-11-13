import { Shell } from './components/Shell';
import { ToastProvider } from './components/Toast';
import { NavProvider } from './state/nav';
import { ProjectProvider } from './state/project';
import { RagProvider } from './state/rag';
import { UpdatesProvider } from './state/updates';

export default function App() {
  return (
    <ToastProvider>
      <ProjectProvider>
        <RagProvider>
          <NavProvider>
            <UpdatesProvider>
              <Shell />
            </UpdatesProvider>
          </NavProvider>
        </RagProvider>
      </ProjectProvider>
    </ToastProvider>
  );
}
