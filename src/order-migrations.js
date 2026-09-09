// Early schema versions added subtotal_paise with a zero default. Repair only
// records whose stored items and adjustments prove the existing charged total.
// Do not change totals, payments, inventory, or ambiguous historical records.
export function backfillLegacyOrderSubtotals(db) {
  return db.prepare(`UPDATE orders SET subtotal_paise=(
    SELECT SUM(line_total_paise) FROM order_items WHERE order_id=orders.id
  ) WHERE subtotal_paise=0 AND total_paise>0
    AND (SELECT SUM(line_total_paise) FROM order_items WHERE order_id=orders.id)>0
    AND (SELECT SUM(line_total_paise) FROM order_items WHERE order_id=orders.id)
      -discount_paise+shipping_paise=total_paise`).run();
}
