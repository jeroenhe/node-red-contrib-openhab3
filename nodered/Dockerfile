# Test with (current) latest Node-RED version on Node.js v12
FROM nodered/node-red:1.3.1-12

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

ENTRYPOINT [ "/docker-entrypoint.sh" ]
