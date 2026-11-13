import { useEffect, useRef, useState } from 'react';
import { t, type Key } from '../i18n';
import { countLaunch, markSeen, nextHint, readHints, type HintState, type Spotlight } from '../lib/hints';
import { firstRunDone } from '../views/PrimiPassi';

export const HINTS_CHANGED = 'cw-hints-changed';
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

let launched: HintState | null = null;
function initial(): HintState {
  // One launch per app start, not per remount (the language switch remounts the Shell).
  launched ??= countLaunch(firstRunDone());
  return readHints();
}

/** First-run guidance, one piece at a time: welcome, the section tip, then one spotlight. */
export function Guide({ section, showTip, onStart }: { section: string; showTip: boolean; onStart(): void }) {
  const [state, setState] = useState<HintState>(initial);
  useEffect(() => {
    const on = () => setState(readHints());
    window.addEventListener(HINTS_CHANGED, on);
    return () => window.removeEventListener(HINTS_CHANGED, on);
  }, []);
  const close = (id: string) => setState(markSeen(id));

  const hint = nextHint(state, section);
  if (!hint) return null;
  if (hint.kind === 'welcome') {
    return (
      <Welcome
        onStart={() => {
          close('welcome');
          onStart();
        }}
      />
    );
  }
  if (hint.kind === 'tip') {
    return showTip ? <Tip section={section} onClose={() => close(hint.id)} /> : null;
  }
  return <Spot spots={hint.spots} onClose={(id) => close(`spot:${id}`)} />;
}

function Welcome({ onStart }: { onStart(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const ideas: Array<[string, string, string]> = [
    ['✎', 'shell.guide.welcome.writeTitle', 'shell.guide.welcome.writeBody'],
    ['you', 'shell.guide.welcome.signTitle', 'shell.guide.welcome.signBody'],
    ['⟲', 'shell.guide.welcome.filesTitle', 'shell.guide.welcome.filesBody'],
  ];
  return (
    <dialog ref={ref} className="dialog guide-welcome" aria-labelledby="guide-welcome-title" onCancel={onStart}>
      <div className="guide-welcome-body">
        <h2 id="guide-welcome-title" className="guide-welcome-title">{t('shell.guide.welcome.title')}</h2>
        <p className="muted">{t('shell.guide.welcome.lead')}</p>
        <ul className="guide-ideas">
          {ideas.map(([icon, title, body]) => (
            <li key={title}>
              <span className={icon === 'you' ? 'guide-ic guide-ic-human' : 'guide-ic'} aria-hidden="true">
                {icon === 'you' ? t('shell.guide.welcome.you') : icon}
              </span>
              <div>
                <b>{t(title as Key)}</b>
                <span>{t(body as Key)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="guide-welcome-foot">
          <small className="muted">{t('shell.guide.welcome.again')}</small>
          <button type="button" className="btn btn-strong" onClick={onStart} autoFocus>
            {t('shell.guide.welcome.start')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Tip({ section, onClose }: { section: string; onClose(): void }) {
  return (
    <div className="guide-tip" role="note">
      <span className="guide-tip-mark" aria-hidden="true">i</span>
      <div>
        <b>{t(`shell.guide.tip.${section}.title` as Key)}</b>
        <p>{t(`shell.guide.tip.${section}.body` as Key, { mod: MOD })}</p>
      </div>
      <button type="button" className="btn" onClick={onClose}>
        {t('shell.guide.gotIt')}
      </button>
    </div>
  );
}

type Box = { top: number; left: number; width: number; height: number };

/** Rings the first spotlight whose target is on screen now; the others wait for their view. */
function Spot({ spots, onClose }: { spots: Spotlight[]; onClose(id: Spotlight['id']): void }) {
  const [shown, setShown] = useState<{ spot: Spotlight; box: Box } | null>(null);
  const target = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ids = spots.map((s) => s.id).join(' ');

  useEffect(() => {
    // ponytail: polls the layout every 400 ms while a spotlight waits; an observer per view is not worth it.
    const measure = () => {
      let found: { spot: Spotlight; el: Element } | null = null;
      if (!document.querySelector('dialog[open]')) {
        for (const spot of spots) {
          const el = [...document.querySelectorAll(spot.selector)].find(visible);
          if (el) {
            found = { spot, el };
            break;
          }
        }
      }
      target.current = found?.el ?? null;
      if (!found) return setShown(null);
      const r = found.el.getBoundingClientRect();
      const spot = found.spot;
      setShown((s) =>
        s && s.spot.id === spot.id && s.box.top === r.top && s.box.left === r.left && s.box.width === r.width
          ? s
          : { spot, box: { top: r.top, left: r.left, width: r.width, height: r.height } },
      );
    };
    measure();
    const id = setInterval(measure, 400);
    const click = (e: MouseEvent) => {
      const el = target.current;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      const spot = spots.find((s) => el.matches(s.selector));
      if (spot) closeRef.current(spot.id);
    };
    document.addEventListener('click', click, true);
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(id);
      document.removeEventListener('click', click, true);
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
    // `ids` stands for `spots`: a new array each render, same content.
  }, [ids]);

  if (!shown) return null;
  const { spot, box } = shown;
  // Sidebar targets get the note on their right; the rest below.
  const right = box.left < 260;
  // A note needs about 140 px: near the bottom of the window it grows upward instead.
  const low = box.top + box.height + 150 > window.innerHeight;
  const vertical = right
    ? low
      ? { bottom: window.innerHeight - box.top - box.height - 6 }
      : { top: box.top - 6 }
    : low
      ? { bottom: window.innerHeight - box.top + 14 }
      : { top: box.top + box.height + 14 };
  const note = { ...vertical, left: right ? box.left + box.width + 18 : Math.max(16, Math.min(box.left, window.innerWidth - 300)) };
  return (
    <>
      <div className={right ? 'guide-ring guide-ring-light' : 'guide-ring'} style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} aria-hidden="true" />
      <div className={`guide-note ${right ? 'guide-note-right' : 'guide-note-below'}`} style={note} role="note">
        <b>{t(`shell.guide.spot.${spot.id}.title`)}</b>
        <span>{t(`shell.guide.spot.${spot.id}.body`, { mod: MOD })}</span>
        <button type="button" className="guide-note-ok" onClick={() => onClose(spot.id)}>
          {t('shell.guide.gotIt')}
        </button>
      </div>
    </>
  );
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}
