import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Lottie from 'lottie-react';
import swipeLeftAnimation from '../assets/swipe-left.json';
import { API_BASE_URL } from '../services/api';
import './Login.css';

interface LoginProps {
  onLogin: (apiKey: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Informe seu código.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': code,
        },
      });

      if (response.ok) {
        onLogin(code);
      } else {
        setError('Código inválido.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-animation" aria-hidden="true">
          <Lottie animationData={swipeLeftAnimation} loop autoplay />
        </div>

        <h1 className="login-title">Acesso</h1>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="access-code">Código</label>
            <div className="input-wrapper">
              <input
                id="access-code"
                type={showCode ? 'text' : 'password'}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="Digite seu código"
                autoComplete="current-password"
                className={error ? 'error' : ''}
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowCode(!showCode)}
                aria-label={showCode ? 'Ocultar código' : 'Mostrar código'}
              >
                {showCode ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && <span className="error-message">{error}</span>}
          </div>

          <button type="submit" className="connect-btn" disabled={isLoading}>
            {isLoading ? 'Conectando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
