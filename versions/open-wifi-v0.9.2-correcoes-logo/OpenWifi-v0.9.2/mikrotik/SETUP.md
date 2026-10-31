# MikroTik — preparação para Open Wi‑Fi v0.6

A v0.6 usa a API nativa do RouterOS para criar/remover entradas em:

```text
/ip hotspot ip-binding
```

As entradas criadas pelo sistema recebem comentários iniciados por `OWIFI|` e usam `type=bypassed`.

## 1. Crie um usuário exclusivo

No terminal da MikroTik, escolha uma senha forte e execute:

```routeros
/user group add name=openwifi policy=read,write,api
/user add name=openwifi group=openwifi password="TROQUE_POR_UMA_SENHA_FORTE"
```

Não use o usuário `admin` no backend.

## 2. Habilite a API apenas para o backend

Para laboratório em rede local, API TCP 8728:

```routeros
/ip service set api disabled=no port=8728 address=IP_DO_BACKEND/32
```

Exemplo, se o notebook estiver fixo em `192.168.88.2`:

```routeros
/ip service set api disabled=no port=8728 address=192.168.88.2/32
```

Não abra 8728 para a Internet.

Para API-SSL, configure um certificado no RouterOS e use o serviço `api-ssl`/porta 8729. Depois, no `.env`, use `MIKROTIK_USE_TLS=true` e `MIKROTIK_PORT=8729`.

## 3. Backend deve continuar acessível sem autenticação HotSpot

A página continua consultando o backend mesmo depois que os 30 segundos terminam. Portanto, o endereço do servidor Open Wi‑Fi precisa estar no Walled Garden.

Exemplo para backend `192.168.88.2:8080`:

```routeros
/ip hotspot walled-garden ip add action=accept dst-address=192.168.88.2 protocol=tcp dst-port=8080 comment="Open Wi-Fi portal"
```

Idealmente o backend fica numa porta/VLAN de gerenciamento e não como um cliente comum do HotSpot.

## 4. Faça o HotSpot informar o MAC ao portal

Durante o desenvolvimento, abra:

```text
http://IP_DO_BACKEND:8080/index.html?mac=AA:BB:CC:DD:EE:FF
```

No HotSpot final, customize `login.html` para redirecionar o navegador para o backend incluindo `$(mac)`.
Use `hotspot-login.template.html` desta pasta como base e troque `IP_DO_BACKEND`.

Quando o backend estiver na mesma rede do HotSpot, prefira:

```env
MIKROTIK_DEVICE_VALIDATION=strict-router
```

Assim o backend consulta `/ip hotspot host` pelo IP da requisição e usa o MAC visto pela própria RB, em vez de confiar no navegador.

## 5. Teste a comunicação

Com o Open Wi‑Fi iniciado em `MIKROTIK_MODE=real`, abra no navegador do notebook:

```text
http://localhost:8080/api/mikrotik/test
```

Resposta esperada:

```json
{
  "ok": true,
  "mode": "real",
  "router": {
    "board-name": "RB750Gr3",
    "version": "..."
  }
}
```

Também aparece no terminal:

```text
MikroTik conectada ✓ ...
```

## O que a v0.6 faz

- início da tentativa: cria bypass temporário do MAC;
- fim dos 30 s: remove somente o bypass temporário;
- QR PIX permanece válido;
- PIX aprovado: troca por bypass pago até a validade do plano;
- a cada 30 s o backend reconcilia o estado e remove bindings vencidos;
- ao reiniciar, acessos pagos ainda válidos são restaurados a partir do `data/store.json`.

### Observação importante

O `ip-binding` não possui um timeout nativo associado ao comentário criado pelo Open Wi‑Fi. Portanto, a expiração nesta versão é aplicada pelo backend/reconciliador. Em operação real, mantenha o backend online. Se ele ficar desligado durante o vencimento de um acesso, a entrada é removida assim que o backend voltar e reconciliar.

