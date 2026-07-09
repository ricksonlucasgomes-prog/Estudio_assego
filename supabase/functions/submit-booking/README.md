# submit-booking — contrato do webhook n8n + notificação WhatsApp

A Edge Function `submit-booking`, depois de gravar a reserva + assinatura,
dispara um POST para o secret `N8N_WEBHOOK_URL` (best-effort, fire-and-forget
com timeout de 5s — **não** bloqueia a resposta ao app).

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

### O que o Lucas precisa fornecer para finalizar
- Phone Number ID + token permanente do app Meta.
- Número da presidência e do Lucas, com DDI/DDD.
- Nome do template aprovado (ou usar `hello_world` no teste).

> Alternativa **grátis e sem burocracia** (se o setup da Meta travar):
> um **bot de Telegram** notifica os mesmos destinos em minutos, sem
> template nem verificação. Só não é WhatsApp.
