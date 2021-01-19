FROM nodered/node-red

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

USER node-red

ENTRYPOINT [ "/docker-entrypoint.sh" ]
