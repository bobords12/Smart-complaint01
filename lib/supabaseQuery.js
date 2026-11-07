const SCHEMA_ERR_RE = /does not exist|could not find a relationship|schema cache/i;

export function isSchemaError(err) {
  return SCHEMA_ERR_RE.test(err?.message || "");
}

export async function selectWithOptionalColumns(
  supabase,
  table,
  baseColumns,
  optionalColumns = [],
  { orderField, ascending = false, limit } = {}
) {
  const attempts = optionalColumns.length
    ? [[...new Set([...baseColumns, ...optionalColumns])].join(", "), baseColumns.join(", ")]
    : [baseColumns.join(", ")];
  let lastError = null;
  for (const selectColumns of attempts) {
    let query = supabase.from(table).select(selectColumns);
    if (orderField) query = query.order(orderField, { ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (!error) return data || [];
    lastError = error;
    if (!isSchemaError(error)) break;
  }
  throw lastError;
}