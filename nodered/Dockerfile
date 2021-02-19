FROM nodered/node-red

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

ENTRYPOINT [ "/docker-entrypoint.sh" ]
