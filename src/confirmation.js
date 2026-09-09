// Presentation only: these helpers never create orders or change payment records.
export function confirmationAnimation(input = {}) {
  const enabled = input?.enabled;
  return {
    enabled: enabled === undefined || enabled === true || enabled === "true" || enabled === "on",
    style: ["checkmark", "confetti", "none"].includes(input?.style) ? input.style : "checkmark",
    accent: "store",
  };
}

export function orderConfirmation(details) {
  const payment = String(details.paymentStatus || "").toLowerCase();
  const method = String(details.paymentMethod || "").toLowerCase();
  const cancelled = [details.fulfillmentStatus, details.deliveryStatus]
    .some(value => String(value).toLowerCase() === "cancelled");
  if (cancelled || ["cancelled", "failed", "refunded"].includes(payment)) {
    const refunded = payment === "refunded";
    return { success: false, label: "ORDER UPDATE", heading: refunded ? "Your payment was refunded." : cancelled || payment === "cancelled" ? "This order was cancelled." : "Your payment could not be confirmed.", message: "Please contact the store for help before trying again.", payment: refunded ? "Refunded" : cancelled || payment === "cancelled" ? "Cancelled" : "Failed" };
  }
  if (method === "cod" && ["pending", "paid"].includes(payment)) {
    return { success: true, label: "ORDER CONFIRMED", heading: "Thank you! Your order is confirmed.", message: payment === "paid" ? "Order confirmed. Payment received." : "Order confirmed. Pay on delivery.", payment: payment === "paid" ? "Cash on Delivery · Paid" : "Cash on Delivery" };
  }
  if (method && payment === "paid") {
    return { success: true, label: "ORDER CONFIRMED", heading: "Thank you! Your order is confirmed.", message: "Order confirmed. Payment received.", payment: "Prepaid · Payment received" };
  }
  return { success: false, label: "PAYMENT PENDING", heading: "We’re checking your payment.", message: "Your order details are saved. Payment has not been confirmed yet. Please do not pay again while confirmation is pending.", payment: "Awaiting confirmation" };
}

export const confirmationIcon = `<div class="confirmation-icon" aria-hidden="true"><svg width="72" height="72" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2"><circle class="confirmation-circle" cx="32" cy="32" r="29"/><path class="confirmation-check" d="m19 32 9 9 18-19" pathLength="1"/></svg><span class="confirmation-confetti">${Array.from({length: 12}, (_, i) => `<i style="--piece:${i};--angle:${i * 30}deg"></i>`).join("")}</span></div>`;
