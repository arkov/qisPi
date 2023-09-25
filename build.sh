#!/bin/sh

# touch exams.txt # create empty file if not exists

podman stop qispi
podman rm qispi

echo "This will take a while..."
podman build -t qispi .

# notice the create, not build/run!
podman create --name=qispi \
-e TZ=Europe/Berlin \
-v $(pwd)/index.js:/usr/src/app/index.js:ro \
# -v $(pwd)/exams.txt:/usr/src/app/exams.txt \
-v $(pwd)/config.json:/usr/src/app/config.json \
-v $(pwd)/redis.conf:/usr/local/etc/redis/redis.conf:ro \
--init qispi

cp qispi.service ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now qispi


# systemctl --user status qispi
# journalctl --user -u qispi | tail -n 20

if [ -x "$(command -v lazydocker)" ]; then
    DOCKER_HOST=unix:///run/user/1000/podman/podman.sock lazydocker
fi
