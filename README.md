# node-red-contrib-openhab2

## Description

Nodes facilitating the automation of *openHAB* ( <http://www.openhab.org> ) items with Node-RED ( <http://nodered.org> ). This is a fork from Peter De Mangelaere [node-red-contrib-openhab2 package](https://flows.nodered.org/node/node-red-contrib-openhab2) with additions I find useful.

![OpenHAB2 Node-RED nodes](images/openhab2_nodes.png)

## Installation

_Note:  first remove the official [node-red-contrib-openhab2](https://flows.nodered.org/node/node-red-contrib-openhab2) package if you have it installed, otherwise they will collide_

1. First enter the container (as nodered user):

    export COMPOSE_PROJECT_NAME=nodered-test
    docker-compose exec nodered /bin/bash

1. Go to the `/data` folder inside the container (`cd /data`)
1. Add the following row inside the `dependencies` entry inside node-red' `packages.json` (`data/` folder) in a syntactically correct way:

    "node-red-contrib-openhab2": "https://github.com/jeroenhendricksen/node-red-contrib-openhab2.git"

1. Perform an `npm install`.
1. Restart nodered for the changes to take effect.

Please note that this installation instruction is different from the (somewhat hidden) installation method used under `Testing` below.

## Nodes

See [77-openhab2.html] for info on nodes.

## Testing

Docker is used to test this plugin in a clean Node-RED and OpenHAB environment.
The openhab2 plugin is installed into Node-RED before the service is started (inside the container).
Prerequisites for running this test environment are docker and docker-compose.

    # Start by running Node-RED and OpenHAB
    ./run.sh

After a little while, you can visit:

- [Node-RED](http://localhost:1880)
- [Openhab](http://localhost:8080)

OpenHAB may require some mandatory configuration before it starts working.
For NodeRED, you can import [flow.json](test/nodered/flow.json) into Node-RED for (manual) testing purposes.

You can verify the server sides event connections:

- [OpenHAB 2](http://localhost:8080/rest/events?topics=smarthome/items)
- [OpenHAB 3](http://localhost:8081/rest/events?topics=openhab/items)

    # To reset the test-setup from scratch (this also removes volumes):
    ./clean.sh
