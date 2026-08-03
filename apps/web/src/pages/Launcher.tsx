import { Link } from 'react-router-dom';
import { Icon } from '../brand/Icon';

/** Tela inicial (/) com as duas "portas": painel administrativo e loja. */
export function Launcher() {
  return (
    <div className="launcher">
      {/*
        Malha Nano do herói do manual. Precisa de pai posicionado (.launcher é
        relative) e fica em z-index 0, abaixo de .launcher-inner — a máscara
        radial do utilitário concentra os pontos no respiro superior direito,
        longe do texto, e o pointer-events:none impede que ela roube o clique
        dos dois cartões.
      */}
      <div className="mesh" aria-hidden />

      <div className="launcher-inner">
        <h1>
          Nova<span style={{ color: 'var(--accent)' }}>Ótica</span>
        </h1>
        <p>Gestão de estoque em tempo real e experiência de compra com provador virtual.</p>

        <div className="tiles">
          <Link to="/admin" className="tile">
            {/*
              Era um emoji de gráfico. Emoji renderiza diferente em cada sistema
              e ignora a cor da marca. O <Icon> herda currentColor do .tile
              (tinta): ouro puro sobre o branco-papel daria 2.17:1 e o traço de
              1,3 sumiria. Sem `title` de propósito — o <h3> ao lado já diz a
              mesma coisa, e rotular o ícone faria o leitor de tela repetir.
            */}
            <div className="glyph">
              <Icon name="painel" size={30} />
            </div>
            <h3>Painel administrativo</h3>
            <p className="muted">
              BI em tempo real, estoque, transferências, relatórios e alertas — para gestores da rede
              e das lojas.
            </p>
          </Link>
          <Link to="/loja" className="tile">
            {/* Era um emoji de óculos escuros. O ícone `loja` é o desenho de
                óculos do manual: duas lentes trapezoidais e a ponte. */}
            <div className="glyph">
              <Icon name="loja" size={30} />
            </div>
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
