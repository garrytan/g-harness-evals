// The pre-push hook pieces check.ts --doctor installs (plan R1). pre-push.local runs bun on the cached, pinned copy of
// the gate, never on the checkout's own check.ts, and lets a push through only when that copy exits 0 and prints a
// receipt naming every pushed ref, its local sha and the pinned gate tree. Any other outcome refuses.

// The public repository under any host (GitHub, a git proxy or an ssh host alias), over https, ssh or scp-like syntax with or
// without a user, with or without .git: any URL whose path ends in garrytan/g-harness-evals, so an unknown form scans.
export function isPublicRemote(url: string): boolean {
  return /(?:^|[/:])garrytan\/g-harness-evals(?:\.git)?\/?$/i.test(url.trim());
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export function hookScript(o: { gateDir: string; gateTree: string; pack: string; pin: string }): string {
  return `#!/usr/bin/env bash
# public-safety pre-push.local, written by scripts/public-safety/check.ts --doctor. It runs the pinned gate copy, not the
# checkout's check.ts, and allows a push only on exit 0 with a receipt for every pushed ref.
set -u
GATE_DIR=${q(o.gateDir)}
GATE12=${q(o.gateTree.slice(0, 12))}
PACK=${q(o.pack)}
PIN=${q(o.pin)}
refuse() {
  echo "public-safety: push refused ($1) docs: docs/public-safety.md#ps-hook" >&2
  echo "public-safety: pushing with --no-verify to a public remote is forbidden; fix the findings or run check.ts --doctor" >&2
  exit 1
}
input=$(cat)
BUN=$(command -v bun 2>/dev/null || true)
if [ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ]; then BUN="$HOME/.bun/bin/bun"; fi
[ -n "$BUN" ] || refuse PS-HOOK-127
out=$(printf '%s\\n' "$input" | "$BUN" --no-env-file --config=/dev/null "$GATE_DIR/check.ts" --hook "$1" "$2" --private-pack "$PACK" --pin "$PIN")
code=$?
[ -n "$out" ] && printf '%s\\n' "$out"
[ "$code" -eq 0 ] || refuse "PS-HOOK-$code"
[ "$out" = "PUBLIC_SAFETY: not-public remote" ] && exit 0
while read -r lref lsha rref rsha; do
  [ -n "$lref" ] || continue
  prefix="PUBLIC_SAFETY: ok ref=$rref head=$lsha gate=$GATE12 pack="
  found=0
  while IFS= read -r line; do
    case "$line" in
      "$prefix"*) rest=\${line#"$prefix"}; [[ $rest =~ ^[0-9a-f]{12}\\ objects=[0-9]+$ ]] && found=1 ;;
    esac
  done <<< "$out"
  [ "$found" = 1 ] || refuse PS-HOOK-RECEIPT
done <<< "$input"
exit 0
`;
}

export const PRE_PUSH = `#!/usr/bin/env bash
# public-safety pre-push, written by scripts/public-safety/check.ts --doctor: runs pre-push.local with the same
# arguments and stdin.
exec "$(dirname "$0")/pre-push.local" "$@"
`;
