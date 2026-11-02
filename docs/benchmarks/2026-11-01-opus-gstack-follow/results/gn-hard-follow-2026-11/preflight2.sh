set -u
t=django__django-15732
d=$(ls -d ~/shard/results/laneb/tasks/$t/environment)
echo "## building the none-arm agent image from $d/Dockerfile (the image Harbor builds for every arm of this task)"
sudo docker build -q -t preflight-agent:15732 "$d" >/dev/null 2>~/preflight-build.err && echo built || { tail -5 ~/preflight-build.err; exit 1; }
gzip -dc ~/laneb/arms/none.tar.gz | sudo docker run --rm -i --network none --entrypoint sh preflight-agent:15732 -c '
tar -xf - -C /root
echo "none arm extracted into /root"
for p in /home/user/.capy /root/.capy /root/.local/share/gstack /opt/gstack /root/.claude/skills/gstack; do [ -e "$p" ] && echo "PRESENT $p" || echo "absent $p"; done
echo "drive paths in container: $(find / -xdev -path "*.capy/drive*" 2>/dev/null | wc -l)"
echo "gstack paths under /root, /home, /opt: $(find /root /home /opt -iname "*gstack*" 2>/dev/null | wc -l)"
echo "/root/.claude/skills entries: $(ls -A /root/.claude/skills 2>/dev/null | wc -l)"
echo "/opt contents: $(ls /opt | tr "\n" " ")"
n=0; IFS=:; for d in $PATH; do for f in "$d"/gstack-*; do [ -e "$f" ] && n=$((n+1)); done; done; echo "gstack-* binaries on container PATH: $n"
echo "claude: $(command -v claude)"'
sudo docker rmi -f preflight-agent:15732 >/dev/null && echo "image removed"
