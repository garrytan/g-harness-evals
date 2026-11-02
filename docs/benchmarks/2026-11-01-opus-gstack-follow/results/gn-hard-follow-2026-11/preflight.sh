set -u
echo "## VM $(hostname)"
for p in /home/user/.capy "$HOME/.capy" /root/.capy; do [ -e "$p" ] && echo "PRESENT $p" || echo "absent $p"; done
echo "drive paths on VM: $(sudo find / -xdev \( -path /proc -o -path /sys -o -path /var/lib/docker \) -prune -o -path '*.capy/drive*' -print 2>/dev/null | wc -l)"
for p in "$HOME/.local/share/gstack" "$HOME/.claude/skills" /opt/gstack; do [ -e "$p" ] && echo "PRESENT $p" || echo "absent $p"; done
n=0; IFS=:; for d in $PATH; do for f in "$d"/gstack-*; do [ -e "$f" ] && n=$((n+1)); done; done; unset IFS; echo "gstack-* binaries on VM PATH: $n"
echo "uploaded laneb parts: $(ls ~/laneb | tr '\n' ' ') arms: $(ls ~/laneb/arms | tr '\n' ' ')"
img=$(sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep -i 'django__django-15732\|django_1776_django-15732' | grep -v '^swebench/' | head -1)
echo "## agent image $img (the same image serves every arm; the arm tar is extracted into /root at trial start)"
sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -i 'django-15732' | head -5
[ -n "$img" ] && sudo docker run --rm --network none --entrypoint sh "$img" -c '
for p in /home/user/.capy /root/.capy /root/.local/share/gstack /opt/gstack /root/.claude/skills/gstack; do [ -e "$p" ] && echo "PRESENT $p" || echo "absent $p"; done
echo "drive paths in image: $(find / -xdev -path "*.capy/drive*" 2>/dev/null | wc -l)"
echo "gstack paths under /root, /home, /opt: $(find /root /home /opt -iname "*gstack*" 2>/dev/null | wc -l)"
echo "/root/.claude contents: $(ls -A /root/.claude 2>/dev/null | tr "\n" " ")"
echo "/opt contents: $(ls /opt | tr "\n" " ")"
n=0; IFS=:; for d in $PATH; do for f in "$d"/gstack-*; do [ -e "$f" ] && n=$((n+1)); done; done; echo "gstack-* binaries on image PATH: $n"'
