The web application in /work/app is about to ship. /work/app/SPEC.md describes how it must behave.

Start it with `/work/app/start.sh` (it serves http://127.0.0.1:8080), test it against the spec, and report every bug you find. Node with Playwright and Chromium, curl and python3 are installed. There is no internet access.

For each bug, write one executable bash script `/work/out/repros/<short-name>.sh` that exits 1 while the bug is present and exits 0 when the app behaves as SPEC.md says. Each script reads the base URL from `$APP_URL` (for example `http://127.0.0.1:8080`), must not depend on another script having run, and must finish within 60 seconds. The scripts will be run against fresh copies of the app. Report each bug once, at most 10 scripts; a script that fails on behaviour that matches the spec counts against you.

Do not modify the application.
