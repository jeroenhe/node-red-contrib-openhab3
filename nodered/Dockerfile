# Test with (current) latest Node-RED version on Node.js v14
# https://hub.docker.com/r/nodered/node-red/tags?page=1&ordering=last_updated
FROM nodered/node-red:2.2.2-14

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

ENTRYPOINT [ "/docker-entrypoint.sh" ]
