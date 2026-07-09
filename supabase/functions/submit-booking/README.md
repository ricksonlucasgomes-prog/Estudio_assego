# submit-booking — notificacao Telegram + contrato n8n

A Edge Function `submit-booking`, depois de gravar a reserva + assinatura,
notifica em modo best-effort, sem bloquear a resposta ao app:

- Telegram direto, se `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_IDS` estiverem
  configurados nos secrets do Supabase.
- n8n opcional, se `N8N_WEBHOOK_URL` estiver configurado.

Ambos usam fire-and-forget com timeout de 5s.

## Telegram agora (caminho gratis e rapido)

### 1. Criar o bot

1. No Telegram, abra `@BotFather`.
2. Envie `/newbot`.
3. Escolha nome e username.
4. Copie o token gerado. Ele tem formato parecido com:
   `1234567890:AA...`.

### 2. Descobrir os chat IDs

Para notificar uma pessoa:

1. A pessoa abre conversa com o bot.
2. Ela envia qualquer mensagem, por exemplo: `teste`.
3. Acesse no navegador:
   `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`.
4. Copie o valor de `message.chat.id`.

Para notificar um grupo:

1. Crie o grupo da diretoria.
2. Adicione o bot ao grupo.
3. Envie uma mensagem no grupo.
4. Acesse `getUpdates` e copie o `chat.id` do grupo. Geralmente comeca com
   `-100...`.

### 3. Configurar os secrets no Supabase

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="<token_do_bot>" TELEGRAM_CHAT_IDS="<chat_id_lucas>,<chat_id_presidencia>"
supabase functions deploy submit-booking
```

Exemplo:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="1234567890:AA..." TELEGRAM_CHAT_IDS="123456789,-1009876543210"
```

### Mensagem enviada

```text
Nova solicitacao — Estudio ASSEGO
Solicitante: Lucas Rickson Gomes da Silva
Contato: +55... · lucas@email.com
Data: 2026-07-09 as 12:00
Participantes (1):
• Badu (+55...)
Assinado por: Lucas Rickson Gomes da Silva
```

Se os secrets Telegram nao existirem, a reserva continua funcionando
normalmente; apenas nao envia alerta.

## Payload enviado ao n8n

```jsonc
{
  "event": "new_studio_booking",
  "timestamp": "2026-07-09T01:58:10.000Z",   // ISO, = signed_at
  "booking_id": "uuid",
  "requester": {                              // linha de studio_booking_requests
    "id": "uuid",
    "requester_name": "string",
    "requester_email": "string",
    "requester_whatsapp": "string",
    "requester_rg": "string",
    "requester_cpf": "string",
    "requester_social": "string",
    "requested_date": "YYYY-MM-DD",
    "requested_time": "HH:MM",
    "status": "requested"
  },
  "guests": [                                 // studio_booking_participants
    { "full_name": "string", "whatsapp": "string", "email": "string",
      "rg": "string", "cpf": "string", "social": "string" }
  ],
  "approvers": ["Lucas Rickson", "Badu", "Sergio Vinicius"],
  "signature": {
    "signer_name": "string",
    "signer_email": "string",
    "document_name": "Termo_de_Uso_Assego.pdf",
    "signed_at": "ISO",
    "ip_address": "string",
    "payload_hash": "sha256-hex"
  }
}
```

## Fluxo n8n (mínimo)

Este fluxo ficou opcional. Use quando quiser voltar para WhatsApp ou outras
automacoes.

1. **Webhook** (HTTP POST). Na URL gerada, atualizar o secret:
   `supabase secrets set N8N_WEBHOOK_URL="https://<n8n>/webhook/<id>"`.
   Configurar **Respond: Immediately** (não segurar a chamada).
2. **Set / Code** — montar o texto da mensagem a partir do payload (ver modelo abaixo).
3. **WhatsApp Business Cloud → Send message** — um envio por destinatário
   (presidência e Lucas).

### Modelo de mensagem

```
🎙️ Nova solicitação de gravação — Estúdio ASSEGO
Solicitante: {{ requester.requester_name }}
Contato: {{ requester.requester_whatsapp }} · {{ requester.requester_email }}
Data: {{ requester.requested_date }} às {{ requester.requested_time }}
Participantes: {{ guests.length }}
{{#each guests}}• {{ full_name }} ({{ whatsapp }})
{{/each}}
Assinado por: {{ signature.signer_name }} — hash {{ signature.payload_hash }}
```

## WhatsApp Cloud API (opção gratuita) — checklist de setup

1. Criar app em https://developers.facebook.com → produto **WhatsApp**.
   Isso já dá um **número de teste** grátis (envia para até 5 destinatários
   liberados — suficiente para presidência + Lucas).
2. Em **API Setup**, anotar o **Phone Number ID** e liberar os 2 números de
   destino (com DDI, ex.: `+55 62 9xxxx-xxxx`).
3. Gerar um **token permanente** via *Business Settings → System Users*
   (o token temporário de dev expira em 24h — sem isso a notificação morre
   no dia seguinte).
4. Criar um **template de utilidade** (ou começar com o pré-aprovado
   `hello_world` para testar o encanamento).
5. No n8n, criar a credencial **WhatsApp Business Cloud** (access token +
   phone number ID) e usar o nó *Send message* com o template.

### O que o Lucas precisa fornecer para finalizar WhatsApp
- Phone Number ID + token permanente do app Meta.
- Número da presidência e do Lucas, com DDI/DDD.
- Nome do template aprovado (ou usar `hello_world` no teste).
