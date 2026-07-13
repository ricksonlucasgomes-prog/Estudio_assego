-- Fecha EXECUTE herdado de funcoes SECURITY DEFINER.
-- As funcoes de trigger nao devem ser chamadas pela API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.archive_studio_checkout() from public, anon, authenticated;

-- Auxiliares de RLS sao necessarias somente para sessoes autenticadas.
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

revoke all on function public.current_user_is_booking_approver() from public, anon;
grant execute on function public.current_user_is_booking_approver() to authenticated;

revoke all on function public.current_user_is_lead_approver() from public, anon;
grant execute on function public.current_user_is_lead_approver() to authenticated;
