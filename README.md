[![Publish NPM package](https://github.com/jeroenhendricksen/node-red-contrib-openhab3/actions/workflows/npm-publish.yml/badge.svg?branch=master)](https://github.com/jeroenhendricksen/node-red-contrib-openhab3/actions/workflows/npm-publish.yml) ![NPM downloads](https://img.shields.io/npm/dm/node-red-contrib-openhab3)

# node-red-contrib-openhab3

## Description

Nodes facilitating the automation of [OpenHAB](https://www.openhab.org) items with Node-RED. This is a fork from Peter De Mangelaere [node-red-contrib-openhab2 package](https://flows.nodered.org/node/node-red-contrib-openhab2) with additions and changes I find useful. This plugin is useful if you want to add rules using the power of Node-RED, instead of the OpenHAB built-in rules.

## Installation

Install this package `node-red-contrib-openhab3` via the `Manage palette` menu of your Node-RED instance.

## Changes

| Version | Description |
| --------------- | --------------- |
| 1.3.20 | Replace request package with axios (#3) |
| 1.3.19 | Use official eventsource package |
| 1.3.18 | Add option for sending NULL-values for get2-node (#22) |
| 1.3.17 | Fix issue #21 |
| 1.3.16 | get2 node only sends state when not NULL |
| 1.3.15 | Pass on existing topic for get2 node when not set from config |
| 1.3.14 | Fix for group members for groups |
| 1.3.13 | Also return group members for groups |
| 1.3.12 | Spread load a little at start-up |
| 1.3.11 | Return all group members for get2-node |
| 1.3.10 | Revert fix error reporting bug for `CommunicationError` |
| 1.3.9  | Fix error reporting bug for `CommunicationError` |
| 1.3.8  | Update the node-documentation shown in Node-RED |
| 1.3.7  | Fix/'work around' for NPE in `77-openhab2.js:396:31` |
| 1.3.6  | Add support for OAuth2 token with OH3 (issue #7) |
| 1.3.5  | Fix openhab2-events2 node to also work with OpenHAB v3 (issue #6)  |
| 1.3.4  | Upgrade this module to be built and tested with Node.js v12 |
| 1.3.3  | Add support for GroupItemStateChangedEvent event |
| 1.3.2  | Remove (useless) nodes picture; Update README |
| 1.3.1  | Update nodes picture in this README |
| 1.3.0  | Renamed all nodes to be unique from the original package |

## Nodes

See [77-openhab2.html](77-openhab2.html) for info on the provided nodes. This is best viewed from Node-RED, adding a node and viewing its corresponding Help page.

## Testing the plugin

Prerequisites for running this test environment are docker and docker-compose. It allows you to test this plugin for development purposes.
Docker is used to start a clean Node-RED, OpenHAB v2 and OpenHAB v3 environment, with this plugin installed into Node-RED before the service is started (inside the container).

    # Start by running Node-RED and OpenHAB
    ./run.sh

After a little while, you can visit:

- [Node-RED](http://localhost:1880)
- [OpenHAB v2](http://localhost:8080)
- [OpenHAB v3](http://localhost:8081)
- [OpenHAB v3 (with authentication)](http://localhost:8082)

When in the Node-RED UI, you can import [flow.json](test/nodered/flow.json) via the `Import` option, which contains some example tests for each of the nodes, per OpenHAB version, running simultaneously.

You can verify the server sides event connections to be working as well. They are used by the plugin to receive any updates from OpenHAB:

- [OpenHAB v2](http://localhost:8080/rest/events?topics=smarthome/items)
- [OpenHAB v3](http://localhost:8081/rest/events?topics=openhab/items)
- [OpenHAB v3 (with authentication)](http://localhost:8082/rest/events?topics=openhab/items)

When finished, you can reset the test-setup from scratch (this also removes volumes):

    ./clean.sh
