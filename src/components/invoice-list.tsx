import type { Invoice } from "@/lib/billing-types";
import { money } from "@/lib/billing-types";
export function InvoiceList({
  invoices,
  hasMore = false,
}: {
  invoices: Invoice[];
  hasMore?: boolean;
}) {
  return invoices.length ? (
    <>
      <div className="billing-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Receipt</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.number || "Invoice"}</td>
                <td>{new Date(i.created * 1000).toLocaleDateString()}</td>
                <td>
                  {money(
                    i.status === "paid" ? i.amountPaid : i.amountDue,
                    i.currency,
                  )}
                </td>
                <td>
                  <span className="billing-badge">{i.status || "Draft"}</span>
                </td>
                <td>
                  {i.url && (
                    <a href={i.url} target="_blank" rel="noopener noreferrer">
                      View invoice ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <p>
          Showing the latest 12 invoices. Your billing portal has the full
          history.
        </p>
      )}
    </>
  ) : (
    <div className="billing-empty">
      <h3>No invoices yet</h3>
      <p>Invoices appear here once billing begins.</p>
    </div>
  );
}
