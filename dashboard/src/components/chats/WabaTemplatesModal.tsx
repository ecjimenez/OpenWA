// Templates Meta da sessão waba-relay: enviar um aprovado pro chat aberto
// (único caminho com a janela de 24h fechada) e submeter template novo à
// análise da Meta. Autocontido: busca, estado e envio vivem aqui; o Chats.tsx
// só abre/fecha.
//
// Strings em pt-BR de propósito (padrão da casa): este fluxo é específico do
// fork e do produto Conversinha; integrará o i18n se um dia subir pro upstream.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Modal } from '../Modal';
import { wabaRelayApi, type WabaTemplate } from '../../services/api';

interface Props {
  sessionId: string;
  chatId: string | null;
  onClose: () => void;
  onSent?: () => void;
}

/** Extrai as variáveis {{n}} do corpo do template aprovado. */
function varsOf(template: WabaTemplate): number {
  const body = (template.componentes as { text?: string; type?: string }[] | null)?.find(
    c => (c.type ?? '').toUpperCase() === 'BODY',
  );
  const matches = body?.text?.match(/\{\{(\d+)\}\}/g) ?? [];
  return new Set(matches).size;
}

function bodyTextOf(template: WabaTemplate): string {
  const body = (template.componentes as { text?: string; type?: string }[] | null)?.find(
    c => (c.type ?? '').toUpperCase() === 'BODY',
  );
  return body?.text ?? '';
}

export default function WabaTemplatesModal({ sessionId, chatId, onClose, onSent }: Props) {
  const [tab, setTab] = useState<'enviar' | 'novo'>('enviar');
  const [templates, setTemplates] = useState<WabaTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WabaTemplate | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Formulário de submissão
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('UTILITY');
  const [idioma, setIdioma] = useState('pt_BR');
  const [corpo, setCorpo] = useState('');
  const [rodape, setRodape] = useState('');
  const [exemplo, setExemplo] = useState('');

  const load = useCallback(() => {
    setLoadError(null);
    wabaRelayApi
      .listTemplates(sessionId)
      .then(setTemplates)
      .catch((err: Error) => setLoadError(err.message));
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const aprovados = useMemo(
    () => (templates ?? []).filter(t => (t.status ?? '').toUpperCase() === 'APPROVED'),
    [templates],
  );

  const selectTemplate = (t: WabaTemplate) => {
    setSelected(t);
    setVars(Array.from({ length: varsOf(t) }, () => ''));
    setFeedback(null);
  };

  const handleSend = async () => {
    if (!selected || !chatId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const components = vars.length
        ? [{ type: 'body', parameters: vars.map(v => ({ type: 'text', text: v })) }]
        : undefined;
      await wabaRelayApi.sendTemplate(sessionId, {
        chatId,
        nome: selected.nome,
        idioma: selected.idioma,
        components,
      });
      setFeedback('Template enviado.');
      onSent?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Falha no envio');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitNew = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const exemplos = exemplo
        .split('|')
        .map(v => v.trim())
        .filter(Boolean);
      const r = await wabaRelayApi.submitTemplate(sessionId, {
        nome,
        idioma,
        categoria,
        corpo,
        ...(rodape.trim() ? { rodape: rodape.trim() } : {}),
        ...(exemplos.length ? { exemplo: exemplos } : {}),
      });
      setFeedback(`Submetido à Meta: ${r.nome} (${r.status}). A aprovação costuma levar minutos a horas.`);
      setNome('');
      setCorpo('');
      setRodape('');
      setExemplo('');
      load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Falha na submissão');
    } finally {
      setBusy(false);
    }
  };

  const podeSubmeter = nome.trim().length > 0 && corpo.trim().length > 0 && !busy;

  return (
    <Modal open onClose={onClose} title="Templates WABA" closeLabel="Fechar" className="status-compose-modal waba-templates-modal">
        <div className="compose-type-toggle">
          <button type="button" className={tab === 'enviar' ? 'active' : ''} onClick={() => setTab('enviar')}>
            Enviar aprovado
          </button>
          <button type="button" className={tab === 'novo' ? 'active' : ''} onClick={() => setTab('novo')}>
            Submeter novo
          </button>
        </div>

        {tab === 'enviar' && (
          <div className="waba-templates-send">
            {templates === null && !loadError && <Loader2 className="animate-spin" size={20} />}
            {loadError && <p className="form-error">{loadError}</p>}
            {templates !== null && aprovados.length === 0 && <p>Nenhum template aprovado nesta conta.</p>}

            {aprovados.length > 0 && (
              <div className="compose-field">
                <label>Template</label>
                <select
                  value={selected?.id ?? ''}
                  onChange={e => {
                    const t = aprovados.find(x => x.id === e.target.value);
                    if (t) selectTemplate(t);
                  }}
                >
                  <option value="" disabled>
                    Escolha um template
                  </option>
                  {aprovados.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({t.idioma})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selected && (
              <>
                <p className="waba-template-preview">{bodyTextOf(selected)}</p>
                {vars.map((v, i) => (
                  <div className="compose-field" key={i}>
                    <label>{`Variável {{${i + 1}}}`}</label>
                    <input value={v} onChange={e => setVars(vars.map((x, j) => (j === i ? e.target.value : x)))} />
                  </div>
                ))}
                <button
                  className="btn-primary"
                  disabled={busy || !chatId || vars.some(v => !v.trim() && vars.length > 0)}
                  onClick={() => void handleSend()}
                >
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Enviar pro chat aberto
                </button>
                {!chatId && <p className="form-hint">Abra uma conversa pra habilitar o envio.</p>}
              </>
            )}
          </div>
        )}

        {tab === 'novo' && (
          <div className="waba-templates-new">
            <div className="compose-field">
              <label>Nome (minúsculas_e_underscore)</label>
              <input value={nome} onChange={e => setNome(e.target.value.toLowerCase())} placeholder="aviso_agenda" />
            </div>
            <div className="compose-row">
              <div className="compose-field">
                <label>Categoria</label>
                <select value={categoria} onChange={e => setCategoria(e.target.value)}>
                  <option value="UTILITY">Utilidade</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </div>
              <div className="compose-field">
                <label>Idioma</label>
                <input value={idioma} onChange={e => setIdioma(e.target.value)} />
              </div>
            </div>
            <div className="compose-field">
              <label>{'Corpo (use {{1}}, {{2}}… pra variáveis)'}</label>
              <textarea rows={5} value={corpo} onChange={e => setCorpo(e.target.value)} />
            </div>
            <div className="compose-field">
              <label>Rodapé (opcional)</label>
              <input value={rodape} onChange={e => setRodape(e.target.value)} />
            </div>
            <div className="compose-field">
              <label>Exemplos das variáveis, separados por | (a Meta exige quando há variável)</label>
              <input value={exemplo} onChange={e => setExemplo(e.target.value)} placeholder="Enrique | quinta 14h" />
            </div>
            <button className="btn-primary" disabled={!podeSubmeter} onClick={() => void handleSubmitNew()}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : null} Submeter à Meta
            </button>
          </div>
        )}

        {feedback && <p className="waba-templates-feedback">{feedback}</p>}
    </Modal>
  );
}
