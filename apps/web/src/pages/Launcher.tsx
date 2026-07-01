import { Link } from 'react-router-dom';

/** Tela inicial (/) com as duas "portas": painel administrativo e loja. */
export function Launcher() {
  return (
    <div className="launcher">
      <div className="launcher-inner">
        <h1>
          Nova<span style={{ color: 'var(--accent)' }}>Ótica</span>
        </h1>
        <p>Gestão de estoque em tempo real e experiência de compra com provador virtual.</p>

        <div className="tiles">
          <Link to="/admin" className="tile">
            <div className="glyph">📊</div>
            <h3>Painel administrativo</h3>
            <p className="muted">
              BI em tempo real, estoque, transferências, relatórios e alertas — para gestores da rede
              e das lojas.
            </p>
          </Link>
          <Link to="/loja" className="tile">
            <div className="glyph">🕶️</div>
            <h3>Loja online</h3>
            <p className="muted">
              Prove os óculos pela câmera (AR) e compre em tempo real, com disponibilidade ao vivo do
              estoque.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
