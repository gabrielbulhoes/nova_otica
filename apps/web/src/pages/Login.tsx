import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Mark } from '../brand/Brand';
import { Icon } from '../brand/Icon';

/**
 * Porta de entrada do console — a primeira (e às vezes única) superfície de
 * marca que o operador vê no dia. Por isso a assinatura completa entra aqui, e
 * não o lockup datilografado que a tela usava antes.
 *
 * Saiu o bloco .traffic (herança dos semáforos do macOS). Ele tinha três <i>
 * dos quais o CSS novo desenha só um — e o que esse um desenha é o símbolo
 * NANOFLOW, o mesmo que a assinatura já traz. Manter os dois colocaria a marca
 * duas vezes na mesma superfície; a limpeza do markup morto e a regra da marca
 * apontavam para a mesma remoção. No AdminShell o .traffic continua fazendo
 * sentido: lá ele é o único símbolo da barra lateral.
 */
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
        {/*
          A assinatura entra SOZINHA: não há nome escrito ao lado dela nesta
          tela. Como ela passa a representar o produto, precisa de `label` — sem
          ele o leitor de tela anuncia "NANOFLOW", que é a marca do sistema de
          design, não o nome do console que a pessoa está abrindo.

          O respiro do manual (30 un.) já está dentro do viewBox, então a margem
          abaixo é só o espaço até a linha de serviço.
        */}
        {/* A marca daqui é a do PRODUTO. O <Signature> desenha NANOFLOW, que é
            a casa que constrói o sistema — pôr o wordmark dela na porta de
            entrada do console da ótica anuncia o fornecedor no lugar do
            cliente. O símbolo é compartilhado; o nome é do produto. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Mark size={34} decorative />
          <span className="brand" style={{ fontSize: 26 }}>
            Nova<span>Ótica</span>
          </span>
        </div>

        {/*
          Linha de serviço no utilitário .label (mono, caixa alta, 0.18em): diz
          o que o produto faz sem competir tipograficamente com a assinatura, e
          usa --muted em vez de ouro, porque é texto pequeno sobre fundo claro.
        */}
        <p className="label" style={{ margin: '0 0 20px' }}>
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
          /*
            Era .badge red. No vocabulário novo o badge é CHIP: mono, caixa alta
            e entreletras largas — uma frase inteira ali sai gritando em
            maiúsculas e some a pontuação. .banner é o componente de mensagem em
            frase. O ícone acompanha o texto para o estado não depender só do
            tom quente do filete, que parte dos operadores não separa do ouro.
          */
          <div className="banner warn" role="alert">
            <Icon name="atencao" size={18} />
            <span>{error}</span>
          </div>
        )}

        {/*
          Único .btn.solid da tela — e o manual permite exatamente um por tela.
          É a ação primária óbvia: não há outra decisão a tomar aqui.
        */}
        <button
          className="btn solid"
          type="submit"
          disabled={loading}
          aria-busy={loading}
          style={{ width: '100%' }}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        {/* A dica de credencial só existe em DEMONSTRAÇÃO.
            O gate estava em VITE_DEMO_USERS — "esta demo tem contas nomeadas?"
            — e não em VITE_DEMO — "isto é uma demo?". Como o build de produção
            não define nenhuma das duas, ele caía no `else` e a tela de login em
            https://app.novaotica.gb.app.br anunciava
            "Demo: admin@novaotica.com / senha admin123". A senha não funciona
            lá, mas a frase entrega um nome de usuário válido e convida a
            tentativa — além de parecer amadorismo para quem paga pelo sistema. */}
        {DEMO && (
          <p className="muted" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
            {import.meta.env.VITE_DEMO_USERS ? (
              'Acesso restrito: use o login e a senha que você recebeu.'
            ) : (
              <>
                Demo: <strong>admin@novaotica.com</strong> / senha <strong>admin123</strong>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
