// Supabase Edge Function: request-equipment
// Usuario sem acesso admin/borrower pede um equipamento justificando o
// motivo. Grava em studio_equipment_requests (RLS: so o proprio usuario
// insere) e avisa os 3 admins por email. Aprovar/rejeitar e feito depois
// no app, restrito ao aprovador unico (Lucas) via RLS.
//
// Secrets necessarios (ja configurados para submit-booking):
//   supabase secrets set GMAIL_USER=... GMAIL_APP_PASSWORD=...
//
// Deploy:
//   supabase functions deploy request-equipment

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
]

async function sendRequestEmail(requesterName: string, requesterEmail: string, equipmentName: string, justification: string) {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) {
    console.warn('GMAIL_USER/GMAIL_APP_PASSWORD nao configurados; pulando envio de email.')
    return
  }
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
      subject: `Pedido de equipamento (fora do admin): ${requesterName}`,
      content:
        `${requesterName} (${requesterEmail}) pediu acesso ao equipamento "${equipmentName}" mesmo sem ` +
        `permissao de admin/retirada.\n\n` +
        `Justificativa:\n${justification}\n\n` +
        `Aprove ou rejeite pelo sininho de notificacoes no app: https://assegostudio.vercel.app`,
    })
  } finally {
    await client.close()
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Token de autorizacao ausente.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Usuario nao autenticado ou token invalido.')

    const body = await req.json()
    const equipmentId = String(body.equipmentId ?? '').trim()
    const equipmentName = String(body.equipmentName ?? '').trim()
    const justification = String(body.justification ?? '').trim()
    const requesterName = String(body.requesterName ?? user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'Usuario')

    if (!equipmentId || !justification) {
      throw new Error('Informe o equipamento e a justificativa.')
    }

    const { data: requestRow, error: insertError } = await supabase
      .from('studio_equipment_requests')
      .insert({
        requester_id: user.id,
        requester_name: requesterName,
        requester_email: user.email ?? null,
        equipment_id: equipmentId,
        equipment_name: equipmentName || equipmentId,
        justification,
      })
      .select()
      .single()

    if (insertError) throw insertError

    await sendRequestEmail(requesterName, user.email ?? '', equipmentName || equipmentId, justification)

    return new Response(JSON.stringify({ success: true, id: requestRow.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro inesperado.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
