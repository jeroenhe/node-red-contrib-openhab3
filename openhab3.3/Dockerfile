# https://hub.docker.com/r/openhab/openhab/tags
FROM openhab/openhab:3.3.0-debian

# Add post userdata/ creation scripts
RUN mkdir /etc/cont-init.d
COPY cont-init.d/* /etc/cont-init.d/
RUN chmod u+x /etc/cont-init.d/*

# Add customize logging
RUN mkdir /override
COPY override/ /override/

ENTRYPOINT ["/entrypoint"]

# Execute command
CMD ["gosu", "openhab", "tini", "-s", "./start.sh"]
