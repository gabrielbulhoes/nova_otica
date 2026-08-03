import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveInvalidation } from '../hooks/useLiveInvalidation';
import { Mark } from '../brand/Brand';
import { Icon } from '../brand/Icon';

/**
 * Casca da vitrine — a única parte do produto que o consumidor final vê.
 *
 * É aqui que a marca precisa aparecer inteira: no console interno o símbolo
 * sozinho basta (o nome do produto já está escrito ao lado, em texto), mas quem
 * abre a loja não tem outro lugar de onde tirar a identidade.
 */

/** `.store-nav nav a` não é flex no CSS; sem isto o ícone desalinha do rótulo. */
const linkComIcone = { display: 'inline-flex', alignItems: 'center', gap: 7 } as const;

export function StoreShell() {
  const { logout } = useAuth();
  useLiveInvalidation();

  return (
    <div className="store">
      <header className="store-nav">
        <Link to="/loja" className="brand" style={{ display: 'flex', alignItems: 'center' }}>
          {/*
            A assinatura entra SOZINHA — não há nome escrito ao lado dela, ao
            contrário do que acontece na barra lateral do console. Por isso ela
            é conteúdo e não enfeite, e carrega `label`: sem ele o leitor de
            tela anunciaria "NANOFLOW", que é a marca do sistema de design e não
            o nome da loja que a pessoa está abrindo. O nome acessível do link
            passa a ser esse rótulo.

            200px fica acima do piso de 164px do manual e resulta em ~31px de
            altura, que cabe na barra de 52px sem espremer o respiro de 30 un.
            que já vem embutido no viewBox da assinatura.
          */}
          {/* Vitrine: quem lê é o consumidor da ótica. Aqui NANOFLOW seria
              ruído — e ficava contradizendo o "A GRACIOSA · REDE DE ÓTICAS"
              logo abaixo, duas marcas na mesma dobra. */}
          <span className="brand" style={{ fontSize: 22, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Mark size={24} decorative />
            Nova<span>Ótica</span>
          </span>
        </Link>
        <nav>
          {/* Ícones da grade 24 do manual, decorativos (sem `title`): o rótulo
              escrito ao lado já diz a mesma coisa e o leitor de tela repetiria. */}
          <NavLink to="/loja" end style={linkComIcone}>
            <Icon name="loja" size={16} />
            Óculos
          </NavLink>
          <NavLink to="/loja/carrinho" style={linkComIcone}>
            <Icon name="compras" size={16} />
            Carrinho
          </NavLink>
          <Link to="/" style={linkComIcone}>
            <Icon name="painel" size={16} />
            Painel
          </Link>
          {/*
            Continua sendo <a> porque `.store-nav nav a` é o seletor que dá o
            tratamento em mono caixa alta a esta barra — e styles.css não é meu.
            Um <a> sem href, porém, não entra na ordem de tabulação nem responde
            a Enter: sem `role`, `tabIndex` e `onKeyDown` a saída da conta seria
            inacessível por teclado na única tela que o cliente final usa.
          */}
          <a
            role="button"
            tabIndex={0}
            onClick={logout}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                logout();
              }
            }}
            style={{ ...linkComIcone, cursor: 'pointer' }}
          >
            <Icon name="sair" size={16} />
            Sair
          </a>
        </nav>
      </header>
      <main className="store-main">
        <Outlet />
      </main>
    </div>
  );
}
