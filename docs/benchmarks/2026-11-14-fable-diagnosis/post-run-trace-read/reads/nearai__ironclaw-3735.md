# nearai__ironclaw-3735
Passes: X 0 of 2, Y 1 of 2
Fault named in the instruction: yes (the interface names the two new DTOs in `crates/ironclaw_product_workflow/src/reborn_services/types.rs` and the `get_run_state` facade method)
- X-a1 FAIL: other. It added `get_run_state` and both DTOs, fixed the cross-user 409 leak in `submit_turn` and also in `create_thread`, and used its own `RebornRunFailure` type for the failure field; its tests passed and the trace does not show what the verifier rejected.
- X-a2 FAIL: other. Much the same work, with `get_run_state` reusing the stricter `webui_inbound` validators for thread and run IDs and the `create_thread` 404 change; the cause of the failure is not visible.
- Y-a2 FAIL: other. Same shape as the passing Y try, also reusing the `webui_inbound` parsers for ID validation; nothing in the trace explains why it failed and Y-a1 passed.
Passing tries did differently: Y-a1 validated IDs the way `get_timeline` already does (`invalid_id` codes), used the turn layer's `SanitizedFailure` for the failure field and left `create_thread` alone. These are small differences that may or may not matter; the DTO definitions are cut from the traces, so the field types cannot be compared.
Rating: NONE, favours neither. All four tries found that only `get_run_state` was missing and built near-identical facades, so the split looks like details of types or error codes that no try could check.
