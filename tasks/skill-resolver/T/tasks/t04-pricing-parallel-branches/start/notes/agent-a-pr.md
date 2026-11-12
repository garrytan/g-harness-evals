# PR: Welcome coupon at checkout (agent-a/coupon)

Task t_31, worker profile coder-1.

- Adds the WELCOME10 coupon: 10% off the order subtotal.
- Switches rounding to ROUND_HALF_UP. Finance asked for this: customer receipts must match the shop tills, which round halves up. Two complaints last month came from 1p differences.
