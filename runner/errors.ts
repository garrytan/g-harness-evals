// Every runner failure is a RunnerError: one line that starts with its HE- code (docs/errors.md), the values
// involved and the fix. Exit 2 unless the code says otherwise; 3 is the budget stop (HE-BUDGET-001).

export class RunnerError extends Error {
  constructor(readonly code: string, message: string, readonly exit = 2) { super(`${code} ${message}`); }
}
