# Runbook · Infra definitiva na DigitalOcean

> Tira a Nova Ótica da demo estática do HostGator e a coloca em produção real:
> banco de verdade, sincronização das 6h com o CDS e deploy automático.
>
> **O que este documento é:** a sequência exata de comandos, com o motivo de
> cada escolha. Executado do começo ao fim, entrega o console no ar em
> `https://app.novaotica.gb.app.br`.
>
> **O que ele não é:** algo que eu possa rodar por você. As credenciais da
> DigitalOcean, do DNS e da Sellbie não estão neste ambiente, e não devem
> estar. Os arquivos de infra já estão no repositório; o que falta é a máquina.

---

## Visão geral

```
        internet
            │  443
    ┌───────▼────────┐
    │     Caddy      │  TLS automático (Let's Encrypt), único exposto
    └───────┬────────┘
            │  rede interna do compose
    ┌───────▼────────┐        ┌──────────────┐
    │  app (API+web) │───────▶│  PostgreSQL  │   sem porta no host
    └───────┬────────┘        └──────┬───────┘
            │ 06:00                  │ 03:00
     sync com o CDS            dump diário → volume `backups`
```

Quatro containers, um arquivo: `docker-compose.prod.yml`. A API serve também o
frontend compilado, então não há dois serviços web para manter em sincronia.

**Custo estimado:** droplet de 2 vCPU / 2 GB ≈ US$ 18/mês. O banco cabe folgado
— a rede tem 211 mil unidades de estoque e ~21,7 mil SKUs, o que dá algumas
centenas de MB com histórico. Comece em 2 GB; 1 GB compila lento e mata o build.

---

## 1. Criar a droplet

No painel da DigitalOcean, no mesmo time/projeto do GB Command Center:

| Campo | Valor | Por quê |
|---|---|---|
| Imagem | Ubuntu 24.04 LTS | suporte até 2029 |
| Plano | Basic · Regular · 2 vCPU / 2 GB / 60 GB | 1 GB não compila o frontend |
| Região | NYC ou MIA | menor latência para Natal; a DO não tem BR |
| Autenticação | **Chave SSH** | senha em porta 22 é varrida em minutos |
| Hostname | `novaotica-prod` | |
| Backups da DO | **ativar** (+20%) | é máquina inteira; o dump diário é do banco |

> Ative também **Monitoring** (grátis) — é o que avisa antes de o disco encher.

Anote o **IP público**. Ele aparece três vezes daqui em diante: no DNS, nos
segredos do GitHub e na allowlist da Sellbie.

---

## 2. Primeiro acesso e blindagem

```bash
ssh root@SEU_IP

# Usuário administrativo (nada roda como root no dia a dia)
adduser --gecos "" gabriel
usermod -aG sudo gabriel
rsync --archive --chown=gabriel:gabriel ~/.ssh /home/gabriel

apt update && apt upgrade -y

# Firewall: só SSH e web. O banco NÃO tem porta publicada no compose, e o
# firewall é a segunda tranca — se um dia alguém acrescentar `ports:` ao
# serviço `db` por engano, o UFW ainda barra.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Login por senha desligado (a chave já está instalada)
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# Atualizações de segurança sozinhas
apt install -y unattended-upgrades && dpkg-reconfigure -f noninteractive unattended-upgrades
```

> **Antes de fechar esta janela**, abra outro terminal e confirme que
> `ssh gabriel@SEU_IP` funciona. Trancar a porta com a chave errada é o jeito
> mais rápido de perder a máquina que você acabou de criar.

Swap — a droplet de 2 GB compila o frontend no limite e o build morre sem aviso:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 3. Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version && docker compose version
```

---

## 4. DNS

No provedor do `gb.app.br`, um registro **A**:

```
app.novaotica    A    SEU_IP    TTL 300
```

Confirme antes de subir o Caddy — ele pede o certificado no primeiro start, e
pedir com o DNS errado queima tentativa no limite da Let's Encrypt (5 por
domínio por semana):

```bash
dig +short app.novaotica.gb.app.br    # tem que devolver SEU_IP
```

---

## 5. Usuário de deploy

O GitHub Actions precisa de uma chave para publicar, e essa chave não pode dar
shell. A trava é o *forced command*: o servidor ignora o comando que a chave
pedir e roda sempre o mesmo script. Vale com o repositório público ou privado —
a chave está nos segredos do GitHub, e o que ela protege é a **máquina**, não o
código.

```bash
# Usuário sem senha e sem sudo, dono só do diretório do projeto
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy      # precisa falar com o Docker

sudo mkdir -p /srv/nova-otica
sudo chown deploy:deploy /srv/nova-otica

sudo -u deploy git clone https://github.com/gabrielbulhoes/nova_otica.git /srv/nova-otica
cd /srv/nova-otica && sudo -u deploy git checkout main
```

> **Se o repositório for privado**, o clone anônimo acima falha. A VPS precisa
> de uma *deploy key* de leitura — chave própria, diferente da que o Actions
> usa, e por isso um vazamento de uma não implica a outra:
>
> ```bash
> sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/id_repo -N "" -C "vps-novaotica-leitura"
> sudo -u deploy cat /home/deploy/.ssh/id_repo.pub
> ```
>
> Cole em **Settings → Deploy keys → Add deploy key** do repositório, com
> *Allow write access* **desmarcado** — a VPS lê, nunca escreve. Depois:
>
> ```bash
> sudo -u deploy tee -a /home/deploy/.ssh/config >/dev/null <<'EOF'
> Host github.com
>   IdentityFile /home/deploy/.ssh/id_repo
>   IdentitiesOnly yes
> EOF
> sudo -u deploy chmod 600 /home/deploy/.ssh/config
> sudo -u deploy ssh-keyscan -t ed25519 github.com >> /home/deploy/.ssh/known_hosts
> sudo -u deploy git clone git@github.com:gabrielbulhoes/nova_otica.git /srv/nova-otica
> ```

Gere o par de chaves **na sua máquina** (a privada nunca toca a VPS):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/novaotica_deploy -C "github-actions-novaotica" -N ""
cat ~/.ssh/novaotica_deploy.pub
```

Na VPS, instale a pública com o forced command:

```bash
sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy tee /home/deploy/.ssh/authorized_keys >/dev/null <<'EOF'
command="/srv/nova-otica/scripts/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA...COLE_A_PUBLICA_AQUI github-actions-novaotica
EOF
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

> Tudo o que essa chave consegue fazer é reimplantar a branch `main`. Sem shell
> (`no-pty`), sem túnel (`no-port-forwarding`), sem ler o `.env`.

---

## 6. Configuração e primeira subida

```bash
cd /srv/nova-otica
sudo -u deploy cp .env.production.example .env
sudo -u deploy chmod 600 .env

# Gere os segredos e cole no arquivo
openssl rand -base64 36    # JWT_SECRET
openssl rand -base64 24    # POSTGRES_PASSWORD
openssl rand -base64 18    # SEED_ADMIN_PASSWORD

sudo -u deploy nano .env
```

Suba com `SELLBIE_MODE=mock` — o console funciona inteiro e nada toca o ERP.
Ligar a integração é o §7, depois que a segurança estiver resolvida.

```bash
sudo -u deploy ./scripts/deploy.sh
```

O script busca a `main`, constrói, aplica as migrações no entrypoint, sobe,
espera o `/health` e **volta sozinho para a versão anterior** se a nova não
ficar saudável.

Verificação:

```bash
curl -fsS https://app.novaotica.gb.app.br/health     # {"status":"ok",...}
docker compose -f docker-compose.prod.yml ps         # 4 serviços de pé
docker compose -f docker-compose.prod.yml logs caddy | grep -i certificate
```

Entre no console e **troque a senha do admin** no primeiro login.

---

## 7. Ligar o CDS

Cinco coisas, e a ordem **importa**. Inverter deixa credencial válida
circulando com IP aberto, ou mistura dado fictício com dado real no banco.

### 7.0 · A pergunta que vem antes de todas — a droplet ALCANÇA o conector?

O `RUNBOOK-ARGOS.md` descreve o conector como *"host interno HTTP em porta
alta"*, e foi escrito quando o plano era rodar **dentro da rede da ótica**.
A produção agora está numa droplet em **Nova York**. São coisas diferentes, e
esta é a única pergunta que pode inviabilizar tudo o que vem depois.

Teste antes de qualquer outra providência (a base URL está com o Gabriel):

```bash
curl -sS -o /dev/null -w 'HTTP:%{http_code} em %{time_total}s\n' \
  --max-time 15 'http://<host-cds>:<porta>/conectorCDS'
```

| Resultado | Significa | O que fazer |
|---|---|---|
| `HTTP:200`, `401`, `403` ou `404` | **alcança** — há rota até lá | seguir para 7.1 |
| `HTTP:000` (timeout) | **não alcança** | parar; ver as opções abaixo |

Se não alcançar, o conector está atrás do firewall da rede e existem três
saídas, em ordem de preferência:

1. **Túnel/VPN** entre a droplet e a rede da ótica (WireGuard). Mantém o
   conector fechado para a internet e cifra o tráfego.
2. **Expor o conector** com TLS e allowlist do IP da droplet.
3. Mover a API para dentro da rede — desfaz a decisão de infraestrutura.

> **HTTP em claro é um problema mesmo se alcançar.** As credenciais viajam nos
> cabeçalhos `x_api_key`/`x_api_token`. Dentro da LAN isso era discutível; entre
> Nova York e Natal, atravessando a internet aberta, é interceptável por
> qualquer intermediário. Se a opção for expor o conector, que seja com
> **HTTPS** — e a base URL passa a começar com `https://`.

### 7.1 · Rotacionar as credenciais

Com a Sellbie: `x_api_key`, `x_api_token`, `x_cliente_id`. As atuais circularam
durante o desenvolvimento e devem morrer.

### 7.2 · Pedir a allowlist do IP

O IP da droplet é o **único** IP de saída da API — não há proxy na frente, então
é o que a Sellbie enxerga.

### 7.3 · Limpar o banco antes da primeira sincronização real

**Este passo não é opcional, e a razão é o próprio desenho do sync: ele só faz
upsert por `externalId`, nunca apaga.**

A instalação subiu em `SELLBIE_MODE=mock`, e o mock gerou 5 lojas fictícias
(São Paulo, Campinas, Rio de Janeiro, Belo Horizonte, Curitiba), 60 produtos e
24 vendas por loja. As lojas fictícias usam `codigo_loja` 1 a 5 — e as reais
também começam em 1.

Sem a limpeza, ao virar para `live`: as cinco primeiras lojas são sobrescritas
pelas reais, e todo o resto do lixo **fica no banco para sempre** — produtos
fantasma na curva ABC, vendas fictícias somando ao faturamento, estoque que não
existe em lugar nenhum. Um console com dado misturado que ninguém sabe explicar,
e que só se resolve depois refazendo tudo.

```bash
cd /srv/nova-otica
COMPOSE="docker compose -f docker-compose.prod.yml"

# 1. Dump de segurança — custa nada e já salvou gente
$COMPOSE exec -T db pg_dump -U nova_otica -Fc nova_otica > /tmp/antes-do-live.dump
ls -lh /tmp/antes-do-live.dump

# 2. Zera o que veio do ERP.
#
#    NÃO use `TRUNCATE ... CASCADE` aqui. Foi o que este runbook mandava, e o
#    resultado em produção (03/08/2026) foi o admin apagado junto: `User` tem
#    `storeId` referenciando `Store`, e o CASCADE derruba TODA tabela com
#    chave estrangeira apontando para a lista — não importa se há linha
#    referenciando ou não.
#
#    DELETE em ordem reversa de dependência, dentro de uma transação: qualquer
#    erro no meio desfaz tudo, em vez de deixar o banco meio limpo.
$COMPOSE exec -T db psql -U nova_otica -d nova_otica -c '
BEGIN;
UPDATE "User" SET "storeId" = NULL;
DELETE FROM "Payment"; DELETE FROM "SaleItem"; DELETE FROM "Sale";
DELETE FROM "InventoryMovement"; DELETE FROM "StockItem";
DELETE FROM "Customer"; DELETE FROM "Product";
DELETE FROM "Seller"; DELETE FROM "Size"; DELETE FROM "Color"; DELETE FROM "Store";
COMMIT;'

# 3. Confirma
$COMPOSE exec -T app node -e '
const {PrismaClient}=require("@prisma/client");(async()=>{const p=new PrismaClient();
console.log("lojas:",await p.store.count(),"| produtos:",await p.product.count(),"| usuarios:",await p.user.count());
await p.$disconnect();})()'
```

**Esperado no passo 3:** `lojas: 0 | produtos: 0 | usuarios: 1`.

### 7.4 · Virar a chave — **entre 06:00 e 07:00, horário de Natal**

A CDS só aceita consumo nessa janela (documentação da Sellbie, 04/08/2026:
*"Horário permitido para uso: 06:00 até 07:00"*). A API valida isso antes de
cada chamada: fora da janela o run vai a `FAILED` e nada é lido — inclusive a
sincronização manual do 7.5. A virada é numa manhã marcada, não "quando estiver
pronto".

```bash
sudo -u deploy nano .env    # SELLBIE_MODE=live + base URL + as 3 credenciais
sudo -u deploy ./scripts/deploy.sh
```

A API valida na subida: com `live` e credencial faltando, ela **se recusa a
iniciar** em vez de subir e falhar silenciosamente às 6h.

### 7.5 · Primeira sincronização, à mão (ainda dentro da janela)

```bash
docker compose -f docker-compose.prod.yml exec app node apps/api/dist/sync/runOnce.js
```

Confira o resultado — e compare com o que a rede tem de verdade:

```bash
docker compose -f docker-compose.prod.yml exec -T app node -e '
const {PrismaClient}=require("@prisma/client");(async()=>{const p=new PrismaClient();
console.log("lojas:",await p.store.count(),"| produtos:",await p.product.count());
const e=await p.stockItem.aggregate({_sum:{quantity:true}});
console.log("unidades em estoque:",e._sum.quantity);
await p.$disconnect();})()'
```

**Esperado:** ~22 lojas, ~21.683 produtos e ~211.026 unidades. Se vier 5 lojas e
60 produtos, o modo continua `mock`. Se vier um número entre os dois, a limpeza
do 7.3 não aconteceu — **pare e reporte**, porque o banco está misturado.

E confira quantos DIAS de venda vieram — é a resposta para a dúvida que
atravessou o projeto inteiro:

```bash
docker compose -f docker-compose.prod.yml exec -T app node -e '
const {PrismaClient}=require("@prisma/client");(async()=>{const p=new PrismaClient();
const r=await p.sale.aggregate({_min:{saleDate:true},_max:{saleDate:true},_count:true});
console.log("vendas:",r._count,"| de",r._min.saleDate,"ate",r._max.saleDate);
await p.$disconnect();})()'
```

O padrão da rota `vendas` é **o último mês**. Se vierem ~30 dias, a amostra de
7 dias da demo era artefato da extração, e os avisos de "janela curta" das telas
somem sozinhos em produção. Se vierem 7, a rede vendeu naqueles dias mesmo.

> As credenciais **não** entram no GitHub, em print, em log ou no Telegram.
> Vivem só no `.env` da VPS, com permissão 600.

---

## 8. Deploy automático

No repositório: **Settings → Environments → New environment → `producao`**.
Se quiser que todo deploy passe por aprovação, marque *Required reviewers* aqui.

Nos segredos **do ambiente `producao`**:

| Segredo | Valor |
|---|---|
| `DEPLOY_HOST` | o IP da droplet |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | conteúdo de `~/.ssh/novaotica_deploy` (a **privada**) |
| `DEPLOY_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 SEU_IP` |
| `DEPLOY_HEALTH_URL` | `https://app.novaotica.gb.app.br/health` |

`DEPLOY_KNOWN_HOSTS` não é burocracia: sem ele o workflow aceitaria qualquer
servidor que atendesse por aquele IP, e o deploy poderia ir para a máquina
errada. O workflow falha de propósito se o segredo estiver ausente.

A partir daí, **merge na `main` publica**. O workflow não roda em
`pull_request`: um workflow com segredos executando código que veio de um PR é
entregar a chave da VPS a quem abriu o PR — e isso vale também com o
repositório privado, porque a revisão do código aconteceria depois de ele já
ter rodado.

Verificar a esteira sem esperar um merge: aba **Actions → Deploy (produção) →
Run workflow**.

---

## 9. Operação do dia a dia

```bash
cd /srv/nova-otica
COMPOSE="docker compose -f docker-compose.prod.yml"

$COMPOSE ps                      # o que está de pé
$COMPOSE logs -f --tail=100 app  # log da API
$COMPOSE restart app             # reiniciar só a API
```

**Backups.** Um dump por dia às 03:00, 14 dias de retenção, no volume
`nova_otica_backups`.

```bash
# Listar
docker run --rm -v nova_otica_backups:/b alpine ls -lh /b

# Trazer o mais recente para a sua máquina (faça isto de vez em quando: backup
# que só existe na mesma máquina não é backup)
scp gabriel@SEU_IP:/tmp/ultimo.dump .

# Restaurar
docker run --rm -v nova_otica_backups:/b alpine sh -c 'cat /b/nova-otica-AAAAMMDD-HHMMSS.dump' \
  | $COMPOSE exec -T db pg_restore -U nova_otica -d nova_otica --clean --if-exists
```

**Rollback manual**, se um deploy passar no health check e ainda assim estiver
errado:

```bash
sudo -u deploy git -C /srv/nova-otica reset --hard SHA_ANTERIOR
sudo -u deploy $COMPOSE build app && sudo -u deploy $COMPOSE up -d
```

> Migração de banco **não** volta com o código. O Prisma só aplica migrações
> aditivas em produção; desfazer schema automaticamente seria pior que o
> problema. Se a falha for de migração, é intervenção manual com o dump em mãos.

---

## 10. Checklist

Só você pode fazer (credenciais):

- [ ] Criar a droplet e anotar o IP
- [ ] Blindar SSH e firewall (§2)
- [ ] Apontar `app.novaotica.gb.app.br` (§4)
- [ ] Criar o usuário `deploy` com forced command (§5)
- [ ] Preencher o `.env` com segredos gerados (§6)
- [ ] Rotacionar as credenciais do CDS e pedir a allowlist do IP (§7)
- [ ] Cadastrar os cinco segredos no ambiente `producao` (§8)

Já está pronto no repositório:

- [x] `docker-compose.prod.yml` — Caddy + API + Postgres + backup, sem porta de
      banco exposta
- [x] `docker/Caddyfile` — TLS automático e cabeçalhos de segurança
- [x] `scripts/deploy.sh` — deploy com health check e rollback automático
- [x] `.github/workflows/deploy.yml` — publicação no merge para `main`
- [x] `.env.production.example` — todas as variáveis, com o porquê de cada uma

---

## 11. Repositório privado — o que muda

Tornar o repositório privado é a escolha certa para trabalho comercial de
cliente, e há um motivo concreto e verificado para fazê-lo agora (§ abaixo).
Mas ele **não substitui** nenhuma das travas deste runbook. O que muda:

| | Público | Privado |
|---|---|---|
| Clone na VPS | anônimo, direto | exige *deploy key* de leitura (§5) |
| Minutos de Actions | ilimitados | consomem a cota do plano (2.000/mês no Free) |
| GitHub Pages | disponível | exige plano Pro/Team |
| Segredos em PR | risco de PR de terceiro | risco menor, não nulo (colaborador) |
| Credenciais em commit | exposição imediata | exposição a quem tem acesso |

O `deploy-pages.yml` publica uma demo em GitHub Pages e **para de funcionar no
plano Free** se o repositório virar privado. Como a entrega ao cliente é o zip
no HostGator, o caminho mais limpo é remover esse workflow em vez de manter uma
esteira quebrada no verde do CI.

### O que privar resolve — e o que não resolve

**Resolve:** um commit abandonado continua baixável por SHA depois de um
force-push. Este repositório tem um: `b7a718e` carrega nove PNGs de auditoria
com dados reais da rede (nomes de loja, saldo, R$ 657.652,91). Eles foram
retirados por *amend* minutos depois, mas o objeto ainda está no servidor e
qualquer pessoa com o SHA o busca com `git fetch origin <sha>` — verificado.
Tornar o repositório privado tira esse objeto do alcance público.

**Não resolve:** o que já foi copiado enquanto o repositório era público, e a
rotação das credenciais do CDS (§7) — elas circularam no desenvolvimento e
precisam morrer independentemente da visibilidade do repositório.

**Não relaxa:** a disciplina de `.gitignore`. Repositório privado ganha
colaborador, é clonado para notebook e pode voltar a ser público com um clique.
Dado comercial e credencial continuam fora do Git.

---

## 12. O que muda para o cliente

A demo do HostGator **continua onde está** e não depende disto — ela é estática
e serve para apresentação. O que a VPS acrescenta:

| | Demo (HostGator) | Produção (VPS) |
|---|---|---|
| Dados | fotografia de 7 dias, embarcada | banco vivo, sincronizado às 6h |
| Estoque | congelado no dia da extração | movimenta de verdade |
| Filtro de período | só o que a amostra cobre | histórico inteiro |
| Curva ABC | 727 SKUs que venderam na janela | todos os que venderem |
| Transferências, decisões | não persistem | persistem e têm histórico |
| Usuários | três contas fixas do build | gestão de usuários por loja |

Os dois limites que a demo declara na tela — janela de 7 dias e números
proporcionais — **desaparecem sozinhos** aqui, porque passam a vir do banco.
