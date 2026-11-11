import { renderInlineCode } from '../lib/inline-code';
import { useState, type ReactNode } from 'react';
import { Empty } from '../components/Empty';
import { UpgradeBanner } from '../components/Compat';
import { NextStepsCard } from '../components/NextSteps';
import { PromoteDialog, SIGN_HINT } from '../components/TrackerDialogs';
import { useToast } from '../components/Toast';
import { useProject } from '../state/project';
import { useNav } from '../state/nav';
import type { AttentionItem, AttentionKind } from '../lib/attention';
import type { TrackerProposalRow } from '../types/wiki';

const GROUPS: Array<{ kind: AttentionKind; title: string }> = [
  { kind: 'decision-proposed', title: 'Decisioni da approvare' },
  { kind: 'proposal', title: 'Proposte da valutare' },
  { kind: 'blocked-task', title: 'Lavori bloccati' },
  { kind: 'handoff-stale', title: 'Handoff da aggiornare' },
  { kind: 'page-drift', title: 'Pagine con sorgenti cambiati' },
  { kind: 'reverify', title: 'Da ri-verificare' },
  { kind: 'risk-unowned', title: 'Rischi gravi senza responsabile' },
  { kind: 'lint-error', title: 'Errori di struttura' },
  { kind: 'lint-legacy', title: 'Pagine da recuperare (recupero graduale)' },
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
        <h1 className="view-title">Per te</h1>
        <UpgradeBanner />
        <NextStepsCard />
        <Empty title="Niente che aspetti te." />
      </section>
    );
  }

  const open = (view: AttentionItem['target']['view'], ref?: string) => (
    <button type="button" className="btn" onClick={() => nav.go(view, ref ?? null)}>
      {VIEW_BUTTON[view]}
    </button>
  );

  /** Italian copy per kind, from structured data only: the English title/detail of computeAttention is never shown. */
  const describe = (item: AttentionItem, index: number): Row | null => {
    const ref = item.target.ref ?? '';
    const key = `${item.kind}:${index}`;
    switch (item.kind) {
      case 'decision-proposed': {
        const d = project.decisions.find((x) => x.number === ref);
        return {
          key,
          title: d ? d.title : `Decisione ${ref}`,
          detail: `Decisione ${ref} proposta, in attesa che tu la accetti o la rifiuti.`,
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
            ? `Proposta di ${p.by || 'qualcuno'}${p.date ? ` del ${p.date}` : ''}.${p.why ? ` ${p.why}` : ''}`
            : 'Proposta in attesa di valutazione.',
          actions: (
            <>
              {p && (
                <button
                  type="button"
                  className="btn btn-human-outline"
                  aria-disabled={!signable}
                  title={signable ? undefined : SIGN_HINT}
                  onClick={() => signable && p && setPromoting(p)}
                >
                  Promuovi a lavoro
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
          detail: `${ref} è fermo.${row?.owner ? ` Responsabile: ${row.owner}.` : ' Nessun responsabile.'}`,
          actions: open('lavori', ref),
        };
      }
      case 'handoff-stale': {
        const behind = project.snapshot?.gitState.handoffCommitsBehind;
        return {
          key,
          title: behind ? `Handoff indietro di ${behind} commit` : 'Handoff non aggiornato',
          detail: 'Il prossimo agente partirebbe da una situazione vecchia.',
          actions: open('handoff'),
        };
      }
      case 'page-drift': {
        const n = item.count ?? 0;
        return {
          key,
          title: ref,
          detail: `${n} ${n === 1 ? 'file sorgente cambiato' : 'file sorgente cambiati'} dall'ultima verifica.`,
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
          detail: `${n} ${n === 1 ? 'punto segnato' : 'punti segnati'} da ri-verificare.`,
          actions: null,
          go: () => nav.go('salute', ref),
        };
      }
      case 'risk-unowned': {
        const r = project.risks?.find((x) => x.id === ref);
        return {
          key,
          title: r ? `${ref} · ${r.risk}` : ref,
          detail: `Rischio ${r?.severity === 'critical' ? 'critico' : 'alto'} senza responsabile: assegnalo nella pagina dei rischi.`,
          actions: open('salute', ref),
        };
      }
      case 'lint-error': {
        const n = item.count ?? 1;
        return {
          key,
          title: ref,
          detail: `${n} ${n === 1 ? 'problema di struttura' : 'problemi di struttura'} in questa pagina.`,
          actions: null,
          go: () => nav.go('salute', ref),
        };
      }
      case 'lint-legacy': {
        const pages = item.count ?? 0;
        const findings = item.findings ?? 0;
        return {
          key,
          title: `${pages} ${pages === 1 ? 'pagina fuori dal nucleo' : 'pagine fuori dal nucleo'}`,
          detail: `${findings} ${findings === 1 ? 'problema' : 'problemi'} (frontmatter, sorgenti spostati) da sistemare un po' alla volta: l'agente li corregge quando tocca quelle pagine.`,
          actions: open('salute'),
        };
      }
    }
  };

  return (
    <section className="view">
      <h1 className="view-title">Per te</h1>
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
              {group.title} <span className="group-count">{rows.length}</span>
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
            toast(`Proposta promossa a ${id}`);
          }}
        />
      )}
    </section>
  );
}

const VIEW_BUTTON: Record<AttentionItem['target']['view'], string> = {
  lavori: 'Apri in Lavori',
  decisioni: 'Apri decisione',
  handoff: 'Apri Handoff',
  salute: 'Apri in Salute',
};
