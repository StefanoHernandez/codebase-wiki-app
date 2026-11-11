import { Shell } from './components/Shell';
import { ToastProvider } from './components/Toast';
import { NavProvider } from './state/nav';
import { ProjectProvider } from './state/project';
import { RagProvider } from './state/rag';

export default function App() {
  return (
    <ToastProvider>
      <ProjectProvider>
        <RagProvider>
          <NavProvider>
            <Shell />
          </NavProvider>
        </RagProvider>
      </ProjectProvider>
    </ToastProvider>
  );
}
