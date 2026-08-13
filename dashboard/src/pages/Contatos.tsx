// Aba Contatos — o registro do gateway do cerebro (regras do Jiji, 12/08/2026):
// quem pode falar com o número, em qual flow e por quanto tempo. O cadastro
// dispara o template de abertura; template ENVIADO = contato habilitado pro
// flow naquele período. Quem não está aqui (ou venceu) recebe a negativa no
// próprio WhatsApp e o "calma lá" acima de 3 mensagens em 90s.
//
// Strings em pt-BR de propósito (fluxo do produto Conversinha, fora do i18n
// de 13 línguas do upstream — mesma decisão do WabaTemplatesModal).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { sessionApi, wabaRelayApi, type GatewayContato, type Session, type WabaTemplate } from '../services/api';

const PERIODOS = [
  { label: '30 dias', value: '30' },
  { label: '60 dias', value: '60' },
  { label: 'Manual (sem vencimento)', value: 'manual' },
] as const;

function periodoParaApi(v: string): number | null {
  return v === 'manual' ? null : Number(v);
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ESTADO_LABEL: Record<GatewayContato['estado'], string> = {
  pendente: 'Pendente (template na fila)',
  ativo: 'Ativo',
  vencido: 'Vencido',
};

function varsDoTemplate(t: WabaTemplate | undefined): number {
  if (!t) return 0;
  const comps = t.componentes as { text?: string; type?: string }[] | null;
  const body = comps?.find(c => (c.type ?? '').toUpperCase() === 'BODY');
  return new Set(body?.text?.match(/\{\{(\d+)\}\}/g) ?? []).size;
}

export default function Contatos() {
  const [relaySessions, setRelaySessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [contatos, setContatos] = useState<GatewayContato[] | null>(null);
  const [templates, setTemplates] = useState<WabaTemplate[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Formulário
  const [waId, setWaId] = useState('');
  const [nome, setNome] = useState('');
  const [flow, setFlow] = useState('livre');
  const [periodo, setPeriodo] = useState<string>('manual');
  const [templateNome, setTemplateNome] = useState('');
  const [templateVars, setTemplateVars] = useState<string[]>([]);

  useEffect(() => {
    void sessionApi.list().then(list => {
      const relays = list.filter(s => s.engine === 'waba-relay');
      setRelaySessions(relays);
      if (relays.length > 0) setSessionId(relays[0].id);
    });
  }, []);

  const carregar = useCallback(() => {
    if (!sessionId) return;
    setErro(null);
    wabaRelayApi
      .listContacts(sessionId)
      .then(setContatos)
      .catch((e: Error) => setErro(e.message));
    wabaRelayApi
      .listTemplates(sessionId)
      .then(ts => setTemplates(ts.filter(t => (t.status ?? '').toUpperCase() === 'APPROVED')))
      .catch(() => setTemplates([]));
  }, [sessionId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const templateSelecionado = useMemo(() => templates.find(t => t.nome === templateNome), [templates, templateNome]);

  useEffect(() => {
    setTemplateVars(Array.from({ length: varsDoTemplate(templateSelecionado) }, () => ''));
  }, [templateSelecionado]);

  const podeCadastrar = /^\d{8,15}$/.test(waId) && templateNome && !busy;

  const cadastrar = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const components = templateVars.length
        ? [{ type: 'body', parameters: templateVars.map(v => ({ type: 'text', text: v })) }]
        : undefined;
      const r = await wabaRelayApi.createContact(sessionId, {
        wa_id: waId,
        ...(nome.trim() ? { nome: nome.trim() } : {}),
        flow,
        periodo_dias: periodoParaApi(periodo),
        template_nome: templateNome,
        ...(components ? { template_components: components } : {}),
      });
      setFeedback(
        r.estado === 'ativo'
          ? 'Contato cadastrado e habilitado — template enviado.'
          : `Contato criado, template ${r.template}${r.motivo ? ` (${r.motivo})` : ''}. A lista reconcilia sozinha.`,
      );
      setWaId('');
      setNome('');
      setTemplateVars([]);
      carregar();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Falha no cadastro');
    } finally {
      setBusy(false);
    }
  };

  const mudarPeriodo = async (c: GatewayContato, valor: string) => {
    try {
      await wabaRelayApi.updateContact(sessionId, c.id, { periodo_dias: periodoParaApi(valor) });
      carregar();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Falha ao atualizar período');
    }
  };

  const remover = async (c: GatewayContato) => {
    if (!window.confirm(`Remover ${c.nome ?? c.wa_id} do gateway? Ele volta a receber a negativa.`)) return;
    try {
      await wabaRelayApi.deleteContact(sessionId, c.id);
      carregar();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Falha ao remover');
    }
  };

  if (relaySessions.length === 0) {
    return (
      <div className="page contatos-page">
        <h1>Contatos</h1>
        <p>Nenhuma sessão waba-relay em execução — o registro do gateway vive nelas.</p>
      </div>
    );
  }

  return (
    <div className="page contatos-page">
      <header className="page-header">
        <h1>Contatos</h1>
        <div className="contatos-header-actions">
          {relaySessions.length > 1 && (
            <select value={sessionId} onChange={e => setSessionId(e.target.value)}>
              {relaySessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.phone ?? 'sem fone'})
                </option>
              ))}
            </select>
          )}
          <button className="btn-secondary" onClick={carregar} aria-label="Recarregar">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <section className="contatos-form card">
        <h2>Cadastrar contato</h2>
        <p className="form-hint">
          O cadastro envia o template de abertura — template enviado = número habilitado pro flow naquele período.
        </p>
        <div className="compose-row">
          <div className="compose-field">
            <label>Número (só dígitos, DDI+DDD)</label>
            <input value={waId} onChange={e => setWaId(e.target.value.replace(/\D/g, ''))} placeholder="5511999999999" />
          </div>
          <div className="compose-field">
            <label>Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Quem é" />
          </div>
        </div>
        <div className="compose-row">
          <div className="compose-field">
            <label>Flow</label>
            <input value={flow} onChange={e => setFlow(e.target.value)} placeholder="livre" />
          </div>
          <div className="compose-field">
            <label>Período</label>
            <select value={periodo} onChange={e => setPeriodo(e.target.value)}>
              {PERIODOS.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="compose-field">
            <label>Template de abertura</label>
            <select value={templateNome} onChange={e => setTemplateNome(e.target.value)}>
              <option value="" disabled>
                Escolha o template
              </option>
              {templates.map(t => (
                <option key={t.id} value={t.nome}>
                  {t.nome} ({t.idioma})
                </option>
              ))}
            </select>
          </div>
        </div>
        {templateVars.map((v, i) => (
          <div className="compose-field" key={i}>
            <label>{`Variável {{${i + 1}}} do template`}</label>
            <input value={v} onChange={e => setTemplateVars(templateVars.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
        <button className="btn-primary" disabled={!podeCadastrar} onClick={() => void cadastrar()}>
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Cadastrar e enviar template
        </button>
        {feedback && <p className="contatos-feedback">{feedback}</p>}
      </section>

      <section className="contatos-lista card">
        <h2>Registro</h2>
        {erro && <p className="form-error">{erro}</p>}
        {contatos === null && !erro && <Loader2 className="animate-spin" size={20} />}
        {contatos !== null && contatos.length === 0 && <p>Ninguém cadastrado — todo mundo recebe a negativa.</p>}
        {contatos !== null && contatos.length > 0 && (
          <div className="contatos-table-wrap">
            <table className="contatos-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Número</th>
                  <th>Flow</th>
                  <th>Período</th>
                  <th>Estado</th>
                  <th>Válido até</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contatos.map(c => (
                  <tr key={c.id}>
                    <td>{c.nome ?? '—'}</td>
                    <td>{c.wa_id}</td>
                    <td>{c.flow}</td>
                    <td>
                      <select
                        value={c.periodo_dias === null ? 'manual' : String(c.periodo_dias)}
                        onChange={e => void mudarPeriodo(c, e.target.value)}
                      >
                        {PERIODOS.map(p => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`contato-estado contato-estado-${c.estado}`}>{ESTADO_LABEL[c.estado]}</span>
                    </td>
                    <td>{c.valido_ate ? fmtData(c.valido_ate) : c.habilitado_em ? 'Sem vencimento' : '—'}</td>
                    <td>
                      <button className="btn-icon" onClick={() => void remover(c)} aria-label="Remover">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
