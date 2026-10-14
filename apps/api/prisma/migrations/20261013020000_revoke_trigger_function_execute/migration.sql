-- Triggers fire without EXECUTE; this keeps both functions off the Data API's /rpc.
REVOKE EXECUTE ON FUNCTION public.sync_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_capture_metadata() FROM PUBLIC, anon, authenticated;
