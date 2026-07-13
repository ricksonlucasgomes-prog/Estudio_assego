import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
])

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
]

const MAX_BODY_BYTES = 64 * 1024
const MAX_GUESTS = 20

type JsonRecord = Record<string, unknown>

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(req: Request, body: JsonRecord, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function validateUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validatePayload(body: JsonRecord): {
  requester: JsonRecord
  guests: JsonRecord[]
  booking: JsonRecord
  signature: JsonRecord
  idempotencyKey: string
} {
  const requester = body.requester
  const guests = body.guests ?? []
  const booking = body.booking_details
  const signature = body.signature
  const idempotencyKey = text(body.idempotencyKey, 64)

  if (!isRecord(requester) || !Array.isArray(guests) || !isRecord(booking) || !isRecord(signature)) {
    throw new Error('PAYLOAD_INVALID')
  }
  if (!validateUuid(idempotencyKey)) throw new Error('IDEMPOTENCY_REQUIRED')
  if (guests.length > MAX_GUESTS || !guests.every(isRecord)) throw new Error('GUESTS_INVALID')
  if (signature.acceptedTerms !== true || text(signature.fullName, 160).length < 3) {
    throw new Error('SIGNATURE_INVALID')
  }

  const requiredRequester = [
    text(requester.name, 160),
    text(requester.rg, 30),
    text(requester.cpf, 20),
    text(requester.whatsapp, 30),
    text(requester.social, 120),
  ]
  if (requiredRequester.some((value) => value.length < 2)) throw new Error('REQUESTER_INVALID')

  const date = text(booking.date, 10)
  const time = text(booking.time, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(09|10|11|13|14|15|16):00$/.test(time)) {
    throw new Error('SLOT_INVALID')
  }

  for (const guest of guests) {
    const requiredGuest = [
      text(guest.name, 160),
      text(guest.rg, 30),
      text(guest.cpf, 20),
      text(guest.email, 254),
      text(guest.whatsapp, 30),
      text(guest.social, 120),
    ]
    if (requiredGuest.some((value) => value.length < 2)) throw new Error('GUEST_INVALID')
  }

  return { requester, guests, booking, signature, idempotencyKey }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim().slice(0, 128)
  return (
    req.headers.get('x-real-ip')
    ?? req.headers.get('cf-connecting-ip')
    ?? ''
  ).slice(0, 128)
}

function safeHeader(value: unknown): string {
  return text(value, 160).replace(/[\r\n]+/g, ' ')
}

async function sendBookingNotificationEmail(payload: JsonRecord): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) throw new Error('SMTP_NOT_CONFIGURED')

  const requester = isRecord(payload.requester) ? payload.requester : {}
  const booking = isRecord(payload.booking_details) ? payload.booking_details : {}
  const guests = Array.isArray(payload.guests) ? payload.guests.filter(isRecord) : []
  const guestsList = guests.length
    ? guests.map((guest, index) =>
        `${index + 1}. ${text(guest.name, 160) || '-'}\n` +
        `   RG: ${text(guest.rg, 30) || '-'}\n` +
        `   CPF: ${text(guest.cpf, 20) || '-'}\n` +
        `   Email: ${text(guest.email, 254) || '-'}\n` +
        `   WhatsApp: ${text(guest.whatsapp, 30) || '-'}\n` +
        `   Rede social: ${text(guest.social, 120) || '-'}`
      ).join('\n\n')
    : 'Nenhum convidado adicional.'

  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })

  try {
    await client.send({
      from: gmailUser,
      to: ADMIN_RECIPIENTS,
      subject: `Nova solicitacao de agendamento - ${safeHeader(requester.name)}`,
      content:
        `Nova solicitacao de agendamento no Assego Studio.\n\n` +
        `===== Dados do solicitante =====\n` +
        `Nome: ${text(requester.name, 160) || '-'}\n` +
        `RG: ${text(requester.rg, 30) || '-'}\n` +
        `CPF: ${text(requester.cpf, 20) || '-'}\n` +
        `Email: ${text(requester.email, 254) || '-'}\n` +
        `WhatsApp: ${text(requester.whatsapp, 30) || '-'}\n` +
        `Rede social: ${text(requester.social, 120) || '-'}\n\n` +
        `Data: ${text(booking.date, 10)}\n` +
        `Horario: ${text(booking.time, 5)}\n\n` +
        `===== Convidados (${guests.length}) =====\n${guestsList}\n\n` +
        `Assinatura digital registrada para ${text(payload.signer_name, 160)}.\n` +
        `Acesse o app para aprovar ou rejeitar: https://assegostudio.vercel.app`,
    })
  } finally {
    await client.close()
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(req, { error: 'Origem nao autorizada.' }, 403)
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Metodo nao permitido.' }, 405)

  const requestId = crypto.randomUUID()

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return jsonResponse(req, { error: 'Solicitacao muito grande.' }, 413)
    }

    let body: JsonRecord
    try {
      const parsed = JSON.parse(rawBody)
      if (!isRecord(parsed)) throw new Error('INVALID_JSON')
      body = parsed
    } catch {
      return jsonResponse(req, { error: 'JSON invalido.' }, 400)
    }

    const input = validatePayload(body)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('BACKEND_NOT_CONFIGURED')

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user?.email) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: allowed, error: rateError } = await admin.rpc('consume_rate_limit_v1', {
      p_actor_id: user.id,
      p_action: 'submit_booking',
      p_limit: 5,
      p_window_seconds: 3600,
    })
    if (rateError) throw rateError
    if (!allowed) return jsonResponse(req, { error: 'Muitas solicitacoes. Tente novamente mais tarde.' }, 429)

    const { data: result, error: rpcError } = await admin.rpc('create_signed_booking_v1', {
      p_user_id: user.id,
      p_auth_email: user.email,
      p_idempotency_key: input.idempotencyKey,
      p_requester: input.requester,
      p_guests: input.guests,
      p_booking: input.booking,
      p_signature: input.signature,
      p_ip: clientIp(req),
      p_user_agent: text(req.headers.get('user-agent'), 512),
    })

    if (rpcError) {
      if (/duplicate key|studio_booking_active_slot_uniq/i.test(rpcError.message)) {
        return jsonResponse(req, { error: 'Este horario acabou de ser reservado.' }, 409)
      }
      if (/Data ou horario|Dados obrigatorios|Convidado|assinatura|termo/i.test(rpcError.message)) {
        return jsonResponse(req, { error: rpcError.message }, 400)
      }
      throw rpcError
    }

    const bookingId = text(result?.booking_id, 64)
    const outboxId = text(result?.outbox_id, 64)
    if (!bookingId) throw new Error('RPC_RESULT_INVALID')

    if (!outboxId) {
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'already_processed',
      }, 200)
    }

    const { data: outbox, error: outboxError } = await admin
      .from('notification_outbox')
      .select('id, payload, status, attempts')
      .eq('id', outboxId)
      .single()
    if (outboxError || !outbox) throw outboxError ?? new Error('OUTBOX_NOT_FOUND')

    await admin
      .from('notification_outbox')
      .update({ status: 'sending', attempts: Number(outbox.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', outboxId)

    try {
      await sendBookingNotificationEmail(outbox.payload as JsonRecord)
      await admin
        .from('notification_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboxId)

      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'sent',
      }, 200)
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : 'EMAIL_ERROR'
      await admin
        .from('notification_outbox')
        .update({
          status: 'failed',
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboxId)

      console.error(`[${requestId}] Falha de notificacao`, message)
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'pending_retry',
        warning: 'Pedido registrado. O aviso por email esta aguardando nova tentativa.',
      }, 202)
    }
  } catch (error) {
    console.error(`[${requestId}] Falha no submit-booking`, error)
    return jsonResponse(req, { error: 'Nao foi possivel concluir a solicitacao.', request_id: requestId }, 500)
  }
})
