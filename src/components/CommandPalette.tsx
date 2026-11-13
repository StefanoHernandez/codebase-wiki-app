import { Command } from 'cmdk';
import { t } from '../i18n';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import { SECTIONS } from '../views';

/** Shortcut modifier as shown to the user. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onLint(): void;
  onCopySync(): void;
  onToggleTheme(): void;
}

export function CommandPalette({ open, onOpenChange, onLint, onCopySync, onToggleTheme }: Props) {
  const { recent, current, snapshot, loading, open: openProject } = useProject();
  const nav = useNav();
  const hasWiki = !!snapshot?.wikiRoot;

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t('shell.palette.label')}
      overlayClassName="palette-overlay"
      contentClassName="palette"
      loop
    >
      <Command.Input className="palette-input" placeholder={t('shell.palette.placeholder')} />
      <Command.List className="palette-list">
        <Command.Empty className="palette-empty">{t('shell.palette.empty')}</Command.Empty>

        {hasWiki && (
          <Command.Group heading={t('shell.palette.goTo')}>
            {SECTIONS.map((s, i) => (
              <Command.Item key={s.id} value={`vai ${s.label}`} onSelect={run(() => nav.go(s.id))}>
                <span>{s.label}</span>
                <kbd>
                  {MOD}
                  {i}
                </kbd>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {recent.some((r) => r.path !== current) && (
          <Command.Group heading={t('shell.palette.projects')}>
            {recent
              .filter((r) => r.path !== current)
              .map((r) => (
                <Command.Item
                  key={r.path}
                  value={`progetto ${r.name} ${r.path}`}
                  disabled={loading}
                  onSelect={run(() => void openProject(r.path))}>
                  <span>{t('shell.palette.open', { name: r.name })}</span>
                  <span className="palette-meta">{r.path}</span>
                </Command.Item>
              ))}
          </Command.Group>
        )}

        <Command.Group heading={t('shell.palette.actions')}>
          {hasWiki && (
            <>
              <Command.Item value="esegui lint controlla struttura" onSelect={run(onLint)}>
                {t('shell.palette.lint')}
              </Command.Item>
              <Command.Item value="copia prompt wiki-sync" onSelect={run(onCopySync)}>
                {t('shell.palette.copySync')}
              </Command.Item>
            </>
          )}
          <Command.Item value="cambia tema chiaro scuro" onSelect={run(onToggleTheme)}>
            {t('shell.palette.theme')}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
