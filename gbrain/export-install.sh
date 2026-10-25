#!/usr/bin/env bash
# Export one harness and split view of the install bundle (internal-task; docs/gbrain-arm.md, "The install ladder") to a mounted
# directory, with a manifest of exactly the files it holds:
#
#   docker run --rm --user "$(id -u):$(id -g)" -v <dest>:/out --entrypoint /opt/sidecar/gbrain/export-install.sh \
#     harness-eval/gbrain:dev <openclaw|hermes> <dev|heldout> /out [gbrain-docs|gbrain-installer]
#
# gbrain-docs (the default):
# <dest>/workspace/...   the harness's scaffolded workspace (skills/ at this commit), to land in /workspace in the harness
# <dest>/.hermes.md      Hermes only: the split's compiled context, to land at /workspace/.hermes.md
# gbrain-installer (internal-task, what gbrain setup <harness> --instructions-only wrote at image build; the same bytes for both splits):
# <dest>/workspace/AGENTS.md   OpenClaw: the brain-first block in the workspace's AGENTS.md, to land at /workspace/AGENTS.md
# <dest>/home/SOUL.md          Hermes: Hermes's own SOUL.md with the block appended, to land at $HERMES_HOME/SOUL.md
# <dest>/manifest.json   harness, split, install kind, gbrain commit, the bundle digest, the view digest (sha256 over
#                        "<path> <sha256>\n" in path order), workspace entries, the context's kept slugs, the installer record,
#                        and every file with its sha256
#
# The runner's preflight exports each gbrain-docs or gbrain-installer cell's view into results/<run>/gbrain-install/<harness>/
# <split>/ (<harness>-installer for the installer) and verifies it against this manifest (HE-GBRAIN-006); the trial mounts the
# directory read-only at /he-gbrain-install. A bundle whose manifest records the installer unavailable (a gbrain commit without
# the setup target) refuses the installer export with gbrain's own words.
set -euo pipefail
harness="${1:-}"; split="${2:-}"; dest="${3:-}"; install="${4:-gbrain-docs}"
refuse() { echo "HE-GBRAIN-006 $1" >&2; exit 2; }
usage="usage: export-install.sh <openclaw|hermes> <dev|heldout> <dest> [gbrain-docs|gbrain-installer]"
case "$harness" in openclaw|hermes) ;; *) refuse "$usage (got harness '$harness')" ;; esac
case "$split" in dev|heldout) ;; *) refuse "$usage (got split '$split')" ;; esac
[ -n "$dest" ] || refuse "$usage"
case "$install" in gbrain-docs|gbrain-installer) ;; *) refuse "$usage (got install '$install')" ;; esac
src=/install
[ -s "$src/manifest.json" ] || refuse "no install bundle at $src/manifest.json; this image was built without the install stage; fix: rebuild (gbrain/README.md)"
if [ "$install" = gbrain-installer ]; then
  avail=$(jq -r --arg h "$harness" '.harnesses[$h].installer | if . == null then "the bundle manifest has no installer section (built by a build-install.ts before the installer rung); fix: rebuild the image" elif has("unavailable") then .unavailable else "ok" end' "$src/manifest.json")
  [ "$avail" = ok ] || refuse "gbrain's installer for $harness is not in this image's bundle: $avail"
  [ -d "$src/$harness/installer" ] || refuse "no $harness installer directory in the bundle at $src/$harness/installer"
  mkdir -p "$dest"
  find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$src/$harness/installer/." "$dest/"
  view_digest=$(jq -r --arg h "$harness" '[.files[] | select(.path | startswith($h + "/installer/"))] | sort_by(.path) | .[] | "\(.path) \(.sha256)"' "$src/manifest.json" | sha256sum | cut -d" " -f1)
  jq --arg h "$harness" --arg s "$split" --arg vd "$view_digest" '
    {harness: $h, split: $s, install: "gbrain-installer", gbrain_commit, gbrain_version, bundle_digest: .digest, view_digest: $vd,
     workspace_entries: [.files[] | .path | select(startswith($h + "/installer/workspace/")) | sub("^" + $h + "/installer/workspace/"; "") | split("/")[0]] | unique,
     skills: 0, context: null, installer: .harnesses[$h].installer,
     commands: [.commands[] | select(.harness == $h and .install == "gbrain-installer")],
     files: [.files[] | select(.path | startswith($h + "/installer/")) | .source_path = .path | .path = (.path | sub("^" + $h + "/installer/"; ""))]}' \
    "$src/manifest.json" > "$dest/manifest.json"
  jq -r '.files[] | "\(.sha256)  \(.path)"' "$dest/manifest.json" | (cd "$dest" && sha256sum -c --quiet -) || refuse "the exported installer view at $dest does not match the bundle manifest"
  echo "$(jq -r '.files | length' "$dest/manifest.json") files, view digest $view_digest"
  exit 0
fi
[ -d "$src/$harness/workspace" ] || refuse "no $harness workspace in the bundle at $src/$harness/workspace"
mkdir -p "$dest"
find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$src/$harness/workspace" "$dest/workspace"
if [ "$harness" = hermes ]; then
  [ -s "$src/hermes/$split/.hermes.md" ] || refuse "no compiled context for hermes/$split in the bundle"
  cp "$src/hermes/$split/.hermes.md" "$dest/.hermes.md"
fi
# The view's files are the bundle manifest's entries for this harness's workspace plus, for Hermes, this split's context,
# re-rooted to the destination (hermes/dev/.hermes.md becomes .hermes.md; <harness>/workspace/x becomes workspace/x).
view_digest=$(jq -r --arg h "$harness" --arg s "$split" '
  [.files[] | select((.path | startswith($h + "/workspace/")) or ($h == "hermes" and .path == ("hermes/" + $s + "/.hermes.md")))]
  | sort_by(.path) | .[] | "\(.path) \(.sha256)"' "$src/manifest.json" | sha256sum | cut -d" " -f1)
jq --arg h "$harness" --arg s "$split" --arg vd "$view_digest" '
  {harness: $h, split: $s, install: "gbrain-docs", gbrain_commit, gbrain_version, bundle_digest: .digest, view_digest: $vd,
   workspace_entries: .harnesses[$h].workspace_entries, skills: .harnesses[$h].skills,
   context: (if $h == "hermes" then .harnesses.hermes.context[$s] else null end),
   commands: [.commands[] | select(.harness == $h and (.install // "gbrain-docs") == "gbrain-docs" and ((.split // $s) == $s))],
   files: [.files[] | select((.path | startswith($h + "/workspace/")) or ($h == "hermes" and .path == ("hermes/" + $s + "/.hermes.md")))
           | .source_path = .path | .path = (if .path == ("hermes/" + $s + "/.hermes.md") then ".hermes.md" else (.path | sub("^" + $h + "/"; "")) end)]}' \
  "$src/manifest.json" > "$dest/manifest.json"
# Prove the copy: every listed file is present with its digest.
jq -r '.files[] | "\(.sha256)  \(.path)"' "$dest/manifest.json" | (cd "$dest" && sha256sum -c --quiet -) || refuse "the exported view at $dest does not match the bundle manifest"
echo "$(jq -r '.files | length' "$dest/manifest.json") files, view digest $view_digest"
