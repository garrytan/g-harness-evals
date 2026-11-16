# harbor-framework__harbor-1764
Passes: X 0 of 2, Y 1 of 2
Fault named in the instruction: yes (the issue names the gemini-cli agent, the GEMINI_OAUTH_CREDS_PATH / GEMINI_FORCE_OAUTH variables and the codex _resolve_oauth_creds_path flow to mirror)
- X-a1 FAIL: other. It added the opt-in resolution, upload, chown and copy into ~/.gemini, set GOOGLE_GENAI_USE_GCA and dropped API-key variables in OAuth mode, much like the pass; it did not write the oauth-personal auth type into settings.json, but the trace does not show what the hidden test checked.
- X-a2 FAIL: other. Same design as X-a1 but symlinked the credential into ~/.gemini instead of copying, and also wrote no settings.json auth type; the exact miss is not visible.
- Y-a2 FAIL: other. It matched Y-a1 closely, including writing security.auth.selectedType oauth-personal to settings.json, but symlinked rather than copied and took the setting names from memory without checking the Gemini CLI source; the trace does not show which detail failed.
Passing tries did differently: Y-a1 read the installed Gemini CLI package source to confirm the auth selection (GOOGLE_GENAI_USE_GCA plus selectedType oauth-personal) and switched from symlink to copy because the CLI rewrites the file on refresh; no single one of those choices is unique to it across the failures.
Rating: NONE, favours neither. All four tries built nearly the same opt-in flow in the right file, and the grades split on implementation details whose link to the hidden test cannot be seen.
