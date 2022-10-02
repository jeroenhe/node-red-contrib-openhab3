# Test with (current) latest Node-RED version on Node.js v18
# https://hub.docker.com/r/nodered/node-red/tags?page=1&ordering=last_updated
FROM nodered/node-red:3.0.2-18

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

ENTRYPOINT [ "/docker-entrypoint.sh" ]
