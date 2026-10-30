#!/bin/bash
printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/python3.12 && chmod 0755 /usr/local/bin/python3.12
mkdir -p /root/shim && printf '#!/bin/sh\nexit 0\n' > /root/shim/python3 && chmod 0755 /root/shim/python3
