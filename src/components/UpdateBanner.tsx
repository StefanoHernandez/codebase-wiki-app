import { openReleasePage } from '../api';
import { useNav } from '../state/nav';
import { useUpdates } from '../state/updates';

/** App and plugin updates, above every view. Nothing installs without a click. */
export function UpdateBanner() {
  const { banner, progress, install, dismiss } = useUpdates();
  const nav = useNav();
  if (!banner) return null;
  const installing = progress !== undefined;
  return (
    <div className={`banner ${banner.error ? 'banner-error' : 'banner-update'}`} role="status">
      <div className="update-banner">
        <div className="update-banner-text">
          {banner.title && <span className="banner-title">{banner.title}</span>}
          {banner.pluginLine && <span>{banner.pluginLine}</span>}
          {banner.error && <span>{banner.error}</span>}
          {installing && <span className="muted">{progress === null ? 'Scaricamento…' : `Scaricamento ${progress}%`}</span>}
        </div>
        {!installing && (
          <div className="update-banner-actions">
            {banner.action === 'install' && (
              <button type="button" className="btn btn-strong" onClick={() => void install()}>
                Aggiorna e riavvia
              </button>
            )}
            {banner.action === 'download' && (
              <button type="button" className="btn btn-strong" onClick={() => void openReleasePage()}>
                Scarica
              </button>
            )}
            {banner.action === 'install' && (
              <button type="button" className="btn" onClick={() => void openReleasePage()}>
                Novità
              </button>
            )}
            {banner.pluginLine && (
              <button type="button" className="btn" onClick={() => nav.go('impostazioni')}>
                Vai al plugin
              </button>
            )}
            <button type="button" className="btn" onClick={dismiss}>
              {banner.action ? 'Più tardi' : 'Chiudi'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
