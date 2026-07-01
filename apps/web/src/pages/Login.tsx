import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@novaotica.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate('/admin');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Não foi possível entrar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <form className="card modal" style={{ width: 360, maxWidth: '92vw' }} onSubmit={submit}>
        <div className="traffic" style={{ padding: '0 0 14px' }}>
          <i className="r" />
          <i className="y" />
          <i className="g" />
        </div>
        <div className="brand" style={{ padding: '0 0 6px', fontSize: 24 }}>
          Nova<span>Ótica</span>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Gestão de estoque da rede
        </p>

        <div className="field">
          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <div className="badge red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
          Demo: <strong>admin@novaotica.com</strong> / senha <strong>admin123</strong>
        </p>
      </form>
    </div>
  );
}
