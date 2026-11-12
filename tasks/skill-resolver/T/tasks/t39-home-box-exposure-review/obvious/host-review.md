# Security review: assistant-box

Based on the command output in host-info/, captured on 2026-11-05. I have not logged in to the box.

## Summary

The biggest problem is SSH: it is forwarded from the internet, still accepts passwords, and is already being brute-forced (3,184 failed password attempts). On top of that the firewall is off, security updates stopped in June, and the assistant gateway listens on all interfaces without TLS.

## Findings (highest risk first)

1. **SSH password login exposed to the internet (high).** sshd -T shows passwordauthentication yes and the router forwards 2222 to 22. auth.log has 3,184 failed password lines.
2. **No security updates since June (high).** Unattended-Upgrade is "0" and the last update stamp is Jun 14.
3. **Gateway on 0.0.0.0:18789 with TLS off (medium).** Anything on the home network can reach it, and the token is sent in clear text.
4. **Firewall inactive (medium).** ufw reports Status: inactive.
5. **Root can log in with a key (medium).** permitrootlogin without-password.
6. **Disk not encrypted (low).** Plain ext4 root partition.
7. **Backups unknown.** Nobody has checked the NAS copy.

## What to change, in order

1. Enable unattended security upgrades and run a full update.
2. Make sure your SSH key works, then disable password authentication and root login. Keep a session open while you reload sshd.
3. Turn on ufw: allow SSH, allow 18789 only from the LAN.
4. Bind the gateway to the LAN interface (or loopback) and enable TLS.
5. Consider replacing the router port forward with Tailscale or WireGuard.
6. Check that backups of ~/.openclaw reach the NAS and test a restore.
7. Encrypt the disk at the next reinstall.

## Commands

    sudo apt update && sudo apt full-upgrade
    sudo dpkg-reconfigure -plow unattended-upgrades
    echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/10-no-passwords.conf
    echo 'PermitRootLogin no' | sudo tee -a /etc/ssh/sshd_config.d/10-no-passwords.conf
    sudo sshd -t && sudo systemctl reload ssh
    sudo ufw allow 22/tcp
    sudo ufw allow from 192.168.1.0/24 to any port 18789 proto tcp
    sudo ufw enable

## What I could not check

- Router settings other than the 2222 forward (UPnP, other forwards).
- Whether the NAS backup exists.
- The gateway token strength.
