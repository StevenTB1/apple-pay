-- Monthly totals in one statement; the total is text so it never passes through a float.
CREATE FUNCTION public.spending_summary(p_owner_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (total_cad text, included_count integer, needs_review_count integer, excluded_count integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT
    coalesce(sum(amount) FILTER (WHERE NOT excluded AND currency = 'CAD' AND amount IS NOT NULL), 0)::numeric(30, 2)::text,
    (count(*) FILTER (WHERE NOT excluded AND currency = 'CAD' AND amount IS NOT NULL))::integer,
    (count(*) FILTER (WHERE NOT excluded AND (amount IS NULL OR currency IS NULL OR currency <> 'CAD')))::integer,
    (count(*) FILTER (WHERE excluded))::integer
  FROM public.transaction
  WHERE owner_id = p_owner_id AND occurred_at >= p_start AND occurred_at < p_end;
$$;

-- Only the API's service-role client may call it; it takes an owner id as a parameter.
REVOKE EXECUTE ON FUNCTION public.spending_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spending_summary(uuid, timestamptz, timestamptz) TO service_role;
