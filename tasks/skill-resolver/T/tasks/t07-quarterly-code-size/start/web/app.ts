import { formatMoney } from "./format";

interface InvoiceView {
  number: string;
  gross: number;
  currency: string;
}

// Renders one invoice row.
export function renderRow(inv: InvoiceView): string {
  return `<tr><td>${inv.number}</td><td>${formatMoney(inv.gross, inv.currency)}</td></tr>`;
}
