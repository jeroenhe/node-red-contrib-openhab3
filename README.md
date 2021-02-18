# node-red-contrib-openhab3

## Description

Nodes facilitating the automation of *openHAB* ( <http://www.openhab.org> ) items with Node-RED ( <http://nodered.org> ). This is a fork from Peter De Mangelaere [node-red-contrib-openhab2 package](https://flows.nodered.org/node/node-red-contrib-openhab2) with additions I find useful.

![OpenHAB2 Node-RED nodes](images/openhab2_nodes.png)

## Installation

Install this package `node-red-contrib-openhab3` via the `Manage palette` menu of your Node-RED instance.

## Nodes

See [77-openhab2.html](77-openhab2.html) for info on the provided nodes.

## Testing the plugin

Docker is used to test this plugin in a clean Node-RED and OpenHAB v2 and v3 environment.
The version on disk is installed into Node-RED before the service is started (inside the container), so any changes can be quickly tested.
Prerequisites for running this test environment are docker and docker-compose.

    # Start by running Node-RED and OpenHAB
    ./run.sh

After a little while, you can visit:

- [Node-RED](http://localhost:1880)
- [OpenHAB v2](http://localhost:8080)
- [OpenHAB v3](http://localhost:8081)

OpenHAB may require some mandatory configuration before it starts working.
For Node-RED, you can import [flow.json](test/nodered/flow.json) into Node-RED for (manual) testing purposes.

You can verify the server sides event connections as well:

- [OpenHAB 2](http://localhost:8080/rest/events?topics=smarthome/items)
- [OpenHAB 3](http://localhost:8081/rest/events?topics=openhab/items)

You can reset the test-setup from scratch (this also removes volumes):

    ./clean.sh
