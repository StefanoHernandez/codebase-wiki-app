import { renderInlineCode } from '../lib/inline-code';
import { useState, type ReactNode } from 'react';
import { Empty } from '../components/Empty';
import { UpgradeBanner } from '../components/Compat';
import { NextStepsCard } from '../components/NextSteps';
import { PromoteDialog } from '../components/TrackerDialogs';
import { useToast } from '../components/Toast';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import { t, tn, type Key } from '../i18n';
import type { AttentionItem, AttentionKind } from '../lib/attention';
import type { TrackerProposalRow } from '../types/wiki';

const GROUPS: Array<{ kind: AttentionKind; title: Key }> = [
  { kind: 'decision-proposed', title: 'esplora.perte.group.decisionProposed' },
  { kind: 'proposal', title: 'esplora.perte.group.proposal' },
  { kind: 'blocked-task', title: 'esplora.perte.group.blockedTask' },
  { kind: 'handoff-stale', title: 'esplora.perte.group.handoffStale' },
  { kind: 'page-drift', title: 'esplora.perte.group.pageDrift' },
  { kind: 'reverify', title: 'esplora.perte.group.reverify' },
  { kind: 'risk-unowned', title: 'esplora.perte.group.riskUnowned' },
  { kind: 'lint-error', title: 'esplora.perte.group.lintError' },
  { kind: 'lint-legacy', title: 'esplora.perte.group.lintLegacy' },
];

const RE_VERIFY = /⚠️? TO RE-VERIFY/g;

interface Row {
  key: string;
  title: string;
  detail: string;
  actions: ReactNode;
  /** Whole row opens this target: for long lists whose only action is "open". */
  go?: () => void;
}

export default function PerTe() {
  const project = useProject();
  const nav = useNav();
  const toast = useToast();
  const [promoting, setPromoting] = useState<TrackerProposalRow | null>(null);
  const signable = !project.actorError;

  const attention = project.attention;
  if (attention.length === 0) {
    return (
      <section className="view">
        <h1 className="view-title">{t('esplora.perte.title')}</h1>
        <UpgradeBanner />
        <NextStepsCard />
        <Empty title={t('esplora.perte.empty')} />
      </section>
    );
  }

  const open = (view: AttentionItem['target']['view'], ref?: string) => (
    <button type="button" className="btn" onClick={() => nav.go(view, ref ?? null)}>
      {t(`esplora.perte.open.${view}` as Key)}
    </button>
  );

  /** Copy per kind, from structured data only: the English title/detail of computeAttention is never shown. */
  const describe = (item: AttentionItem, index: number): Row | null => {
    const ref = item.target.ref ?? '';
    const key = `${item.kind}:${index}`;
    switch (item.kind) {
      case 'decision-proposed': {
        const d = project.decisions.find((x) => x.number === ref);
        return {
          key,
          title: d ? d.title : t('esplora.perte.decisionFallback', { ref }),
          detail: t('esplora.perte.decisionDetail', { ref }),
          actions: open('decisioni', ref),
        };
      }
      case 'proposal': {
        const proposals = project.tracker?.proposals ?? [];
        const index = proposals.findIndex((x) => x.proposal === ref);
        const p = index >= 0 ? proposals[index] : null;
        return {
          key,
          title: ref,
          detail: p
            ? t('esplora.perte.proposalBy', {
                by: p.by || t('esplora.perte.someone'),
                date: p.date ? t('esplora.perte.proposalDate', { date: p.date }) : '',
                why: p.why ? ` ${p.why}` : '',
              })
            : t('esplora.perte.proposalPending'),
          actions: (
            <>
              {p && (
                <button
                  type="button"
                  className="btn btn-human-outline"
                  aria-disabled={!signable}
                  title={signable ? undefined : t('lavori.dialog.signHint')}
                  onClick={() => signable && p && setPromoting(p)}
                >
                  {t('esplora.perte.promote')}
                </button>
              )}
              {open('lavori', ref)}
            </>
          ),
        };
      }
      case 'blocked-task': {
        const row = project.tracker?.open.find((r) => r.id === ref);
        return {
          key,
          title: row?.goal || ref,
          detail: t('esplora.perte.blocked', { ref, owner: row?.owner ? t('esplora.perte.owner', { owner: row.owner }) : t('esplora.perte.noOwner') }),
          actions: open('lavori', ref),
        };
      }
      case 'handoff-stale': {
        const behind = project.snapshot?.gitState.handoffCommitsBehind;
        return {
          key,
          title: behind ? t('esplora.perte.handoffBehind', { n: behind }) : t('esplora.perte.handoffStale'),
          detail: t('esplora.perte.handoffDetail'),
          actions: open('handoff'),
        };
      }
      case 'page-drift': {
        const n = item.count ?? 0;
        return {
          key,
          title: ref,
          detail: tn('esplora.perte.drift', n),
          actions: null,
          go: () => nav.go('salute', ref),
        };
      }
      case 'reverify': {
        const page = project.pages.find((p) => p.relPath === ref);
        const n = (page?.markdown.match(RE_VERIFY) || []).length;
        return {
          key,
          title: ref,
          detail: tn('esplora.perte.reverify', n),
          actions: null,
          go: () => nav.go('salute', ref),
        };
      }
      case 'risk-unowned': {
        const r = project.risks?.find((x) => x.id === ref);
        return {
          key,
          title: r ? `${ref} · ${r.risk}` : ref,
          detail: t(r?.severity === 'critical' ? 'esplora.perte.risk.critical' : 'esplora.perte.risk.high'),
          actions: open('salute', ref),
        };
      }
      case 'lint-error': {
        const n = item.count ?? 1;
        return {
          key,
          title: ref,
          detail: tn('esplora.perte.lint', n),
          actions: null,
          go: () => nav.go('salute', ref),
        };
      }
      case 'lint-legacy': {
        const pages = item.count ?? 0;
        const findings = item.findings ?? 0;
        return {
          key,
          title: tn('esplora.perte.legacyTitle', pages),
          detail: tn('esplora.perte.legacyDetail', findings),
          actions: open('salute'),
        };
      }
    }
  };

  return (
    <section className="view">
      <h1 className="view-title">{t('esplora.perte.title')}</h1>
      <UpgradeBanner />
      <NextStepsCard />
      {GROUPS.map((group) => {
        const rows = attention.flatMap((a, i) => {
          if (a.kind !== group.kind) return [];
          const row = describe(a, i);
          return row ? [row] : [];
        });
        if (rows.length === 0) return null;
        return (
          <section key={group.kind} className="group">
            <h2 className="group-title">
              {t(group.title)} <span className="group-count">{rows.length}</span>
            </h2>
            <ul className="rows">
              {rows.map((r) => (
                <li key={r.key} className="row">
                  {r.go ? (
                    <button type="button" className="row-main row-link" onClick={r.go}>
                      <span className="row-title">{renderInlineCode(r.title)}</span>
                      <span className="row-detail">{renderInlineCode(r.detail)}</span>
                    </button>
                  ) : (
                    <div className="row-main">
                      <p className="row-title">{renderInlineCode(r.title)}</p>
                      <p className="row-detail">{renderInlineCode(r.detail)}</p>
                    </div>
                  )}
                  {r.go ? <span className="row-chevron" aria-hidden="true">›</span> : <div className="row-actions">{r.actions}</div>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {promoting && (
        <PromoteDialog
          proposal={promoting}
          onClose={() => setPromoting(null)}
          onDone={(id) => {
            setPromoting(null);
            toast(t('esplora.perte.promoted', { id }));
          }}
        />
      )}
    </section>
  );
}

