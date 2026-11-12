def test_export_three_orders(client, account_with_orders):
    acct = account_with_orders(3)
    resp = client.get(f"/accounts/{acct.id}/orders/export.csv")
    assert resp.status_code == 200
    lines = resp.content.decode().splitlines()
    assert lines[0] == "order_id,created_at,customer_email,total,currency,status"
    assert len(lines) == 4
