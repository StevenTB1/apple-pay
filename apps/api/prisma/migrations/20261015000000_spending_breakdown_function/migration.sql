-- All-time CAD spending grouped by month, card, merchant and source, plus an overall row
-- and a count of purchases left out of the totals because they need review.
CREATE FUNCTION public.spending_breakdown(p_owner_id uuid)
RETURNS TABLE (dimension text, key text, total_cad text, purchase_count integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH included AS (
    SELECT
      to_char(occurred_at AT TIME ZONE 'America/Toronto', 'YYYY-MM') AS month,
      coalesce(card_label, CASE WHEN source = 'MANUAL' THEN 'Manual entry' ELSE 'Unknown card' END) AS card,
      coalesce(merchant, 'Unknown merchant') AS merchant,
      source::text AS source,
      amount
    FROM public.transaction
    WHERE owner_id = p_owner_id AND NOT excluded AND currency = 'CAD' AND amount IS NOT NULL
  )
  SELECT
    CASE
      WHEN GROUPING(month) = 0 THEN 'month'
      WHEN GROUPING(card) = 0 THEN 'card'
      WHEN GROUPING(merchant) = 0 THEN 'merchant'
      WHEN GROUPING(source) = 0 THEN 'source'
      ELSE 'all'
    END,
    coalesce(month, card, merchant, source, 'all'),
    coalesce(sum(amount), 0)::numeric(30, 2)::text,
    count(*)::integer
  FROM included
  GROUP BY GROUPING SETS ((month), (card), (merchant), (source), ())
  UNION ALL
  SELECT 'needs_review', 'needs_review', '0.00', count(*)::integer
  FROM public.transaction
  WHERE owner_id = p_owner_id AND NOT excluded
    AND (amount IS NULL OR currency IS NULL OR currency <> 'CAD');
$$;

-- Only the API's service-role client may call it; it takes an owner id as a parameter.
REVOKE EXECUTE ON FUNCTION public.spending_breakdown(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spending_breakdown(uuid) TO service_role;
