# assistant-box: host review

Based only on the read-only output in host-info/ (captured 2026-11-05). I did not log in or change anything.

## Current posture

assistant-box is a Ubuntu 24.04 mini PC on the home LAN whose only job is the OpenClaw gateway. SSH is reachable from the internet through the router's 2222 to 22 forward, it still accepts passwords, and auth.log shows 3,184 failed password attempts. The host firewall is off, the gateway listens on every interface without TLS, the disk is not encrypted, automatic security updates are off and the last successful apt update was in June. Backups are unverified. For a box that is reachable from outside and holds the assistant's state, this is weaker than it should be, mostly because of SSH.

## Findings

1. **High: SSH password login is exposed to the internet.** Evidence: sshd-effective.txt shows passwordauthentication yes; README.md says the router forwards 2222 to 22; 3,184 "Failed password" lines in auth.log. Why it matters: anyone on the internet can keep guessing passwords, and one weak or reused password gives a shell on the box that holds the assistant's tokens.
2. **High: no security updates since June.** Evidence: Unattended-Upgrade "0" and update-success-stamp dated Jun 14. Why it matters: an internet-facing sshd and the rest of the system have five months of unpatched fixes.
3. **Medium: gateway bound to 0.0.0.0 with TLS off.** Evidence: gateway-status.txt bind 0.0.0.0:18789, tls off; listening.txt confirms. Why it matters: every device on the home Wi-Fi (guests, smart TVs) can reach it, and its token travels in clear text on the LAN. It is not forwarded by the router, so it is not internet-facing today.
4. **Medium: host firewall inactive.** Evidence: firewall.txt "Status: inactive". Why it matters: nothing limits which ports are reachable if a new service starts or the router forward changes. OpenClaw does not manage the OS firewall; this is an OS setting.
5. **Medium: root login by key allowed.** Evidence: permitrootlogin without-password. Why it matters: a stolen key gives root directly instead of a user that still needs sudo.
6. **Low: disk not encrypted.** Evidence: lsblk shows plain ext4 on nvme0n1p2, no crypto_LUKS. Why it matters: if the box is stolen, the assistant's state and tokens can be read off the disk.
7. **Unknown: backups.** Evidence: README.md only says "sometimes". Why it matters: no known restore path for ~/.openclaw.

## Recommended plan

First choose a posture with Dev; the plan below assumes Balanced, since the box is reachable from outside:

1. Convenience: LAN only, minimal prompts. Drop the router forward and keep the rest close to today.
2. Balanced: secure defaults, low friction. Keys only for SSH, firewall on, gateway limited to the LAN, updates on.
3. Strict: treat it as a public server. Everything in Balanced plus no router forward (tailnet only), disk encryption and tighter SSH limits.

Staged and reversible, keeping an open session while changing access:

1. Turn on security updates (no access risk). Rollback: set Unattended-Upgrade back to "0".
2. Confirm Dev's SSH key works on a second session, then set PasswordAuthentication no and PermitRootLogin no. Rollback: restore the backed-up sshd_config and reload, from the still-open session.
3. Enable ufw allowing 22 from anywhere (or from the LAN only if the router forward goes) and 18789 from the LAN subnet only. Rollback: ufw disable.
4. Bind the gateway to the LAN address or loopback plus a tailnet, rather than 0.0.0.0, and turn TLS on if it stays on the LAN.
5. Replace the router forward with a tailnet if Dev agrees; then remove 2222 to 22.
6. Verify a backup of ~/.openclaw to the NAS and do one test restore.
7. Add a scheduled openclaw security audit --deep.
8. Plan disk encryption for the next rebuild (it needs a reinstall or offline conversion).

## Commands

Read-only, safe to run now:

    openclaw security audit --deep
    openclaw gateway status --deep
    openclaw doctor --lint
    sudo ss -ltnup
    sudo sshd -T | grep -Ei 'passwordauthentication|permitrootlogin'
    ls -l ~/.ssh/authorized_keys

Write actions, only after Dev approves each one:

    sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
    sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
    printf 'PasswordAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/10-hardening.conf
    sudo sshd -t && sudo systemctl reload ssh
    sudo ufw allow 22/tcp && sudo ufw allow from 192.168.1.0/24 to any port 18789 proto tcp && sudo ufw enable

## Gaps

- The LAN subnet (I assumed 192.168.1.0/24) and whether anything else on the LAN needs the gateway.
- Router settings beyond the 2222 forward, including UPnP.
- Whether a backup exists and restores.
- The gateway's token strength and the OpenClaw security audit itself, which was not in the capture.
- Who else has keys in authorized_keys.
