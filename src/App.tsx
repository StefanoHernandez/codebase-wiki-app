import { Shell } from './components/Shell';
import { ToastProvider } from './components/Toast';
import { NavProvider } from './state/nav';
import { ProjectProvider } from './state/project';

export default function App() {
  return (
    <ToastProvider>
      <ProjectProvider>
        <NavProvider>
          <Shell />
        </NavProvider>
      </ProjectProvider>
    </ToastProvider>
  );
}
