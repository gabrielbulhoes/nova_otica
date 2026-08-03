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

## 5. Usuário de deploy (a parte que protege o repositório público)

O GitHub Actions precisa de uma chave para publicar. O repositório é **público**
— então a chave não pode dar shell. A trava é o *forced command*: o servidor
ignora o comando que a chave pedir e roda sempre o mesmo script.

```bash
# Usuário sem senha e sem sudo, dono só do diretório do projeto
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy      # precisa falar com o Docker

sudo mkdir -p /srv/nova-otica
sudo chown deploy:deploy /srv/nova-otica

sudo -u deploy git clone https://github.com/gabrielbulhoes/nova_otica.git /srv/nova-otica
cd /srv/nova-otica && sudo -u deploy git checkout main
```

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

## 7. Ligar o CDS (só depois da rotação)

Ordem que importa — inverter deixa credencial válida circulando com IP aberto:

1. **Rotacionar** com a Sellbie: `x_api_key`, `x_api_token`, `x_cliente_id`.
   As antigas circularam durante o desenvolvimento e devem morrer.
2. **Pedir allowlist** do IP da droplet no conector. Ele é o único IP de saída
   da API — não há proxy na frente, então é o que a Sellbie vê.
3. Só então, na VPS:

```bash
sudo -u deploy nano .env      # SELLBIE_MODE=live + as três credenciais novas
sudo -u deploy ./scripts/deploy.sh
```

A API valida na subida: com `live` e credencial faltando, ela **se recusa a
iniciar** em vez de subir e falhar silenciosamente às 6h.

Primeira sincronização à mão, sem esperar o lote:

```bash
docker compose -f docker-compose.prod.yml exec app node apps/api/dist/sync/runOnce.js
```

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

A partir daí, **merge na `main` publica**. O workflow não roda em `pull_request`
— num repositório público isso entregaria os segredos a qualquer PR de terceiro.

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

## 11. O que muda para o cliente

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
