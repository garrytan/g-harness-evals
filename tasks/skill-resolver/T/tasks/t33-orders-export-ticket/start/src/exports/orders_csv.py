import csv
import io

from django.http import HttpResponse

from orders.models import Order

COLUMNS = ["order_id", "created_at", "customer_email", "total", "currency", "status"]


def export_orders_csv(request, acct):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)
    for order in Order.objects.filter(account=acct).order_by("created_at"):
        writer.writerow([order.id, order.created_at.isoformat(), order.customer_email, order.total, order.currency, order.status])
    resp = HttpResponse(buf.getvalue(), content_type="text/csv")
    resp["Content-Disposition"] = 'attachment; filename="orders.csv"'
    return resp
