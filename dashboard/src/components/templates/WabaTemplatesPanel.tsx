// Templates Meta da conta WABA na página Modelos (sessões waba-relay): lista
// com status, seleção pra ver o conteúdo e exclusão (vai até a Graph API via
// relay — irreversível, todas as variantes de idioma do nome).
//
// Strings em pt-BR de propósito (padrão da casa): fluxo específico do fork.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileText, Loader2, Trash2, X } from 'lucide-react';
import { Modal } from '../Modal';
import { wabaRelayApi, type WabaTemplate } from '../../services/api';

interface Props {
  sessionId: string;
  canWrite: boolean;
}

type Componente = { type?: string; text?: string };

/** O sync da Meta grava o array direto; a submissão local grava {components: [...]}. */
function componentesDe(template: WabaTemplate): Componente[] {
  const raw = template.componentes;
  if (Array.isArray(raw)) return raw as Componente[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { components?: unknown }).components)) {
    return (raw as { components: Componente[] }).components;
  }
  return [];
}

function textoDe(template: WabaTemplate, tipo: string): string {
  return componentesDe(template).find(c => (c.type ?? '').toUpperCase() === tipo)?.text ?? '';
}

function statusClasse(status: string | null): string {
  const s = (status ?? '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'REJECTED') return 'rejected';
  return 'pending';
}

export function WabaTemplatesPanel({ sessionId, canWrite }: Props) {
  const [templates, setTemplates] = useState<WabaTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WabaTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    wabaRelayApi
      .listTemplates(sessionId)
      .then(setTemplates)
      .catch((err: Error) => setLoadError(err.message));
  }, [sessionId]);

  useEffect(() => {
    setTemplates(null);
    setSelectedId('');
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const selected = useMemo(
    () => (templates ?? []).find(t => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await wabaRelayApi.deleteTemplate(sessionId, deleteTarget.nome);
      setToast({ type: 'success', message: `Template "${deleteTarget.nome}" excluído.` });
      setDeleteTarget(null);
      setSelectedId('');
      load();
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao excluir' });
    } finally {
      setDeleting(false);
    }
  };

  if (templates === null && !loadError) {
    return (
      <div className="templates-loading-inline">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <div className="waba-templates-panel">
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      )}

      {loadError && <p className="form-error">{loadError}</p>}

      {templates !== null && templates.length === 0 && (
        <div className="templates-empty-list">
          <FileText size={40} strokeWidth={1} />
          <h3>Nenhum template na conta</h3>
          <p>Submeta um novo pelo modal "Templates WABA" no Chats.</p>
        </div>
      )}

      {templates !== null && templates.length > 0 && (
        <div className="waba-templates-grid">
          <div className="waba-templates-picker">
            <label htmlFor="waba-template-select">Template ({templates.length})</label>
            <select id="waba-template-select" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              <option value="">Escolha um template…</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.nome} ({t.idioma}) — {(t.status ?? 'PENDING').toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="waba-template-card">
              <div className="waba-template-card-header">
                <div>
                  <h3>{selected.nome}</h3>
                  <span className={`waba-status ${statusClasse(selected.status)}`}>
                    {(selected.status ?? 'PENDING').toUpperCase()}
                  </span>
                </div>
                {canWrite && (
                  <button
                    className="icon-btn danger"
                    title="Excluir template"
                    onClick={() => setDeleteTarget(selected)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <dl className="waba-template-meta">
                <div>
                  <dt>Idioma</dt>
                  <dd>{selected.idioma}</dd>
                </div>
                <div>
                  <dt>Categoria</dt>
                  <dd>{selected.categoria ?? '—'}</dd>
                </div>
                <div>
                  <dt>Sincronizado</dt>
                  <dd>{selected.sincronizado_em ? new Date(selected.sincronizado_em).toLocaleString() : '—'}</dd>
                </div>
              </dl>

              {textoDe(selected, 'HEADER') && <p className="waba-template-header-text">{textoDe(selected, 'HEADER')}</p>}
              <pre className="waba-template-body">{textoDe(selected, 'BODY') || '(sem corpo)'}</pre>
              {textoDe(selected, 'FOOTER') && <p className="waba-template-footer-text">{textoDe(selected, 'FOOTER')}</p>}

              {selected.motivo_rejeicao && (
                <p className="form-error">Motivo da rejeição: {selected.motivo_rejeicao}</p>
              )}
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title="Excluir template"
          className="modal-sm"
          closeLabel="Fechar"
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </button>
              <button className="btn-danger" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                Excluir
              </button>
            </>
          }
        >
          <p>
            Excluir "{deleteTarget.nome}" apaga o template na Meta (todas as variantes de idioma) e é
            irreversível. Continuar?
          </p>
        </Modal>
      )}
    </div>
  );
}
