#!/bin/sh
redis-server /usr/local/etc/redis/redis.conf &
node index.js