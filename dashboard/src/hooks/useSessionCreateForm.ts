import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pluginsApi, sessionApi, type Engine, type Session } from '../services/api';
import { useToast } from './useToast';

export interface UseSessionCreateFormArgs {
  onCreated: (session: Session) => void;
  onFailed: (message: string) => void;
}

export interface SessionCreateForm {
  showCreateModal: boolean;
  setShowCreateModal: (open: boolean) => void;
  newSessionName: string;
  setNewSessionName: (name: string) => void;
  availableEngines: Engine[];
  selectedEngine: string;
  setSelectedEngine: (engine: string) => void;
  enginesLoading: boolean;
  engineSelectionAvailable: boolean;
  creating: boolean;
  handleCreate: () => Promise<void>;
}

/**
 * Owns the "New Session" modal: its open/closed state, the typed name, and the in-flight `creating`
 * flag. This is a separate feature from onboarding a session onto WhatsApp — `handleCreate` never
 * touches `qrData`/pairing state and never opens the QR modal (that's `handleStart`/`handleShowQR`).
 * Its only outward edges are the created `Session` and a failure message: the page owns appending to
 * `sessions` and invalidating the shared query cache, so this hook stays independent of that state.
 */
export function useSessionCreateForm({ onCreated, onFailed }: UseSessionCreateFormArgs): SessionCreateForm {
  const { t } = useTranslation();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [availableEngines, setAvailableEngines] = useState<Engine[]>([]);
  const [selectedEngine, setSelectedEngineState] = useState('');
  const [enginesLoading, setEnginesLoading] = useState(false);
  const engineTouchedRef = useRef(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!showCreateModal) {
      engineTouchedRef.current = false;
      return;
    }

    let cancelled = false;
    setEnginesLoading(true);

    Promise.allSettled([pluginsApi.getEngines(), pluginsApi.getCurrentEngine()])
      .then(([enginesResult, currentResult]) => {
        if (cancelled) return;
        const enabledEngines = enginesResult.status === 'fulfilled' ? enginesResult.value.filter(engine => engine.enabled) : [];
        setAvailableEngines(enabledEngines);

        if (!engineTouchedRef.current) {
          const fallbackEngine = enabledEngines[0]?.id ?? '';
          const currentEngine = currentResult.status === 'fulfilled' ? currentResult.value.engineType : '';
          const nextEngine = enabledEngines.some(engine => engine.id === currentEngine) ? currentEngine : fallbackEngine;
          setSelectedEngineState(nextEngine);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableEngines([]);
        if (!engineTouchedRef.current) setSelectedEngineState('');
      })
      .finally(() => {
        if (!cancelled) setEnginesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showCreateModal]);

  const setSelectedEngine = (engine: string) => {
    engineTouchedRef.current = true;
    setSelectedEngineState(engine);
  };

  const handleCreate = async () => {
    if (!newSessionName.trim()) return;
    try {
      setCreating(true);
      const engine = availableEngines.some(option => option.id === selectedEngine) ? selectedEngine : undefined;
      const newSession = await sessionApi.create({ name: newSessionName, engine });
      setNewSessionName('');
      setShowCreateModal(false);
      toast.success(t('sessions.create.successTitle'), t('sessions.create.successDesc', { name: newSession.name }));
      onCreated(newSession);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sessions.create.errorDefault');
      toast.error(t('sessions.create.errorTitle'), msg);
      onFailed(msg);
    } finally {
      setCreating(false);
    }
  };

  return {
    showCreateModal,
    setShowCreateModal,
    newSessionName,
    setNewSessionName,
    availableEngines,
    selectedEngine,
    setSelectedEngine,
    enginesLoading,
    engineSelectionAvailable: availableEngines.length > 0,
    creating,
    handleCreate,
  };
}
