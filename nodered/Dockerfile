FROM nodered/node-red

USER root
COPY docker-entrypoint.sh /
RUN chmod a+x /docker-entrypoint.sh

# USER node-red
# COPY data/package.json /data/

ENTRYPOINT [ "/docker-entrypoint.sh" ]
