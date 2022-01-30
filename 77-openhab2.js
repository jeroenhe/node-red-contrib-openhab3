/*

  openHAB nodes for IBM's Node-Red
  https://github.com/pdmangel/node-red-contrib-openhab2
  (c) 2017, Peter De Mangelaere <peter.demangelaere@gmail.com>

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

*/

var EventSource = require('eventsource');
const axios = require('axios').default;
const ax = axios.create({
    timeout: 5000
});

const OH_NULL = 'NULL';
const V2_EVENTSOURCE_URL_PART = 'smarthome';
const V3_EVENTSOURCE_URL_PART = 'openhab';


function getConnectionString(config) {
    'use strict';
    var url = 'http';

    if (config.protocol) {
        url = config.protocol;
    }
    url += '://';

    // Only set username and password inside the url when BOTH username and
    // password are provided and non-empty.
    if (config.username != null && config.username.trim().length != 0 &&
         config.password != null && config.password.length != 0) {
        url += encodeURIComponent(config.username.trim());
        url += ':' + encodeURIComponent(config.password);
        url += '@';
    }
    url += config.host;

    if ((config.port != null) && (config.port.trim().length != 0)) {
        url += ':' + config.port.trim();
    }

    if ((config.path != null) && (config.path.trim().length != 0)) {
        var path = config.path.trim();

        path = path.replace(/^[\/]+/, '');
        path = path.replace(/[\/]+$/, '');

        url += '/' + path;
    }
    return url;
}

function extractItemName(url, topic) {
    var itemStart = url.length;
    return topic.substring(itemStart, topic.indexOf('/', itemStart));
}

function trimString(string, length) {
    return string.length > length ?
        string.substring(0, length - 3) + '...' :
        string;
}

function getAuthorizationHeader(config) {
    var options = {};
    if (config.token != null && typeof(config.token) === 'string' && config.token.length != 0) {
        options.headers = {
            Authorization: 'Bearer ' + config.token
        };
    }
    return options;
}

// Special function for https://github.com/jeroenhendricksen/node-red-contrib-openhab3/issues/22
function shouldSendStateForGet2(sendnull, state) {
    return sendnull || shouldSendState(state);
}

function shouldSendState(state) {
    return state != null && state.toUpperCase() != OH_NULL;
}

function getRandomInt(lower, upper) {
    if (lower > upper || lower < 0 || upper < 1) {
        return 0;
    }
    return parseInt(Math.random() * (upper - lower)) + lower;
}

function getLocalTime() {
    return new Date().toTimeString().split(' ')[0];
}

function stringifyAsJson(message, maxSize) {
    return trimString(JSON.stringify(message), maxSize);
}

module.exports = function (RED) {

    /**
     * ====== httpAdmin ================
     * Enable controller route to static files
     * ===========================================
     */
    RED.httpAdmin.get('/static/*', function (req, res) {
        var options = {
            root: __dirname + '/static/',
            dotfiles: 'deny'
        };
        res.sendFile(req.params[0], options);
    });

    /**
     * ====== openhab2-controller ================
     * Holds the hostname and port of the
     * openHAB server
     * ===========================================
     */
    function OpenHABControllerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.getConfig = function () {
            return config;
        };

        // node.log("OpenHABControllerNode config: " + JSON.stringify(config));

        // this controller node handles all communication with the configured openhab server
        function getInitialStateOfItems(config) {
            //node.log("getStateOfItems : config = " + JSON.stringify(config));

            var url = getConnectionString(config) + "/rest/items";
            var options = getAuthorizationHeader(config);
            // https://axios-http.com/docs/example
            ax.get(url, options)
                .then(response => {
                    if (response.data != null && response.data.length > 0) {
                        node.emit('CommunicationStatus', 'ON');
                        node.log("Connection established. Emitting " + response.data.length + " InitialEvents.");
                        response.data.forEach(function (item) {
                            node.emit(item.name + '/InitialEvent', item);
                        });
                    } else {
                        // OpenHAB is only ready when there is at least one item present. Only then
                        // can we retrieve all initial states.
                        node.log("Number of openHAB items is 0. Rescheduling InitialStateEvent...");
                        setTimeout(function () {
                            getInitialStateOfItems(config);
                        }, 10000);
                    }
                })
                .catch(error => {
                    if (error.response) {
                        // The request was made and the server responded with a status code
                        // that falls out of the range of 2xx
                        // console.log(error.response.data);
                        // console.log(error.response.status);
                        // console.log(error.response.headers);
                        var errorMessage = 'Request error response status ' + error.response.status + ' on ' + url;
                        node.warn(errorMessage);
                        node.emit('CommunicationError', errorMessage);
                        setTimeout(function () {
                            getInitialStateOfItems(config);
                        }, 10000);
                    } else {
                        // Something happened in setting up the request that triggered an Error
                        var errorMessage2 = 'Request error: ' + stringifyAsJson(error.message, 50) + ' on ' + url;
                        node.warn(errorMessage2);
                        node.emit('CommunicationError', errorMessage2);
                        setTimeout(function () {
                            getInitialStateOfItems(config);
                        }, 10000);
                    }
                });
        }

        function startEventSource() {

            // register for all item events (including Thing addition and removal events)
            var eventsource_url = config.ohversion == 'v3' ? '/rest/events?topics=openhab/items' : '/rest/events?topics=smarthome/items';
            var sseUrl = getConnectionString(config) + eventsource_url;
            var options = getAuthorizationHeader(config);
            // node.log('config.ohversion: ' + config.ohversion + ' eventsource_url: ' + eventsource_url);
            node.es = new EventSource(sseUrl, options);

            // handle the 'onopen' event
            node.es.onopen = function () {
                node.log("Opened connection to " + sseUrl);
                // get the current state of all items
                getInitialStateOfItems(config);
            };

            // handle the 'onmessage' event
            node.es.onmessage = function (msg) {
                try {
                    // Only process SSE-events with type 'message'
                    if (msg.type != 'message') {
                        return;
                    }

                    // update the node status with the Item's new state
                    msg = JSON.parse(msg.data);
                    if (msg.payload && msg.payload.constructor == String) {
                        msg.payload = JSON.parse(msg.payload);

                        var url = V2_EVENTSOURCE_URL_PART + '/items/';
                        if (config.ohversion === 'v3') {
                            url = V3_EVENTSOURCE_URL_PART + '/items/';
                        }
                        var item = extractItemName(url, msg.topic);

                        // https://nodered.org/docs/api/modules/v/1.3/@node-red_util_events.html
                        // emit a message to any in2 node for the item
                        node.emit(item + '/RawEvent', msg);

                        // emit a message to the controller node
                        node.emit('RawEvent', msg);
                    }
                } catch (e) {
                    // report an unexpected error
                    node.error('Unexpected Error : ' + e);
                }
            };

            // handle the 'onerror' event
            node.es.onerror = function (err) {
                if (err.type && (JSON.stringify(err.type) === '{}')) {
                    return; // ignore
                }
                node.warn('Error: ' + stringifyAsJson(err, 150));
                node.debug('Error for url "' + sseUrl + '" with headers: ' + stringifyAsJson(options, 150) + ': ' + stringifyAsJson(err, 150));
                node.emit('CommunicationStatus', 'OFF');
                node.emit('CommunicationError', err);

                if (err.status) {
                    var errorStatus = parseInt(err.status);
                    var baseErrorStatus = Math.floor(errorStatus / 100);
                    if (baseErrorStatus == 4 || baseErrorStatus == 5) {
                        // the EventSource object has given up retrying ... retry reconnecting after 10 seconds
                        node.es.close();
                        delete node.es;

                        node.warn('Restarting EventSource (after delay)');

                        setTimeout(function () {
                            startEventSource();
                        }, 10000);
                    }
                }
            };
        }

        // Initialize with OFF
        node.emit('CommunicationStatus', 'OFF');

        // give the system a few random seconds before starting to process the event stream
        setTimeout(function () {
            startEventSource();
        }, getRandomInt(1000, 5000));

        // register a method 'control' for getting and modifying Item and Group state.
        this.control = function (itemname, topic, payload, okCb, errCb) {
            var url;
            var headers = {
                "Content-type": "text/plain"
            };
            var method = 'get';
            var payloadString = null;
            if (payload) {
                payloadString = String(payload);
            }

            if (topic === "ItemUpdate") {
                url = getConnectionString(config) + "/rest/items/" + itemname + "/state";
                method = 'put';
            } else if (topic === "ItemCommand") {
                url = getConnectionString(config) + "/rest/items/" + itemname;
                method = 'post';
            } else {
                url = getConnectionString(config) + "/rest/items/" + itemname;
                //headers = {};
                headers = {
                    "Content-type": "application/json"
                };
                method = 'get';
            }

            // Axios cheat sheet: https://kapeli.com/cheat_sheets/Axios.docset/Contents/Resources/Documents/index
            ax({
                method: method,
                url: url,
                data: payloadString,
                headers: headers
              })
            .then(response => {
                // console.log(response.data);
                // console.log(response.statusText + ": " + response.status + " sending " + method + "-request with body '" + payload + "' to " + url + " returned response: " + response.data);
                // console.log(JSON.stringify(response.data));
                okCb(response.data);
            })
            .catch(error => {
                var errorMsg = "";
                if (error.response) {
                    errorMsg = "Error HTTP status " + error.response.status + " sending " + method + "-request with body '" + payload + "' to " + url;
                } else {
                    errorMsg = "Error: '" + error.message + "' sending " + method + "-request with body '" + payload + "' to " + url;
                }
                node.emit('CommunicationError', errorMsg);
                errCb(errorMsg);
            });
        };

        this.on("close", function () {
            node.log('close');
            node.es.close();
            delete node.es;
            node.emit('CommunicationStatus', 'OFF');
        });
    }
    RED.nodes.registerType("openhab2-controller2", OpenHABControllerNode);

    // start a web service for enabling the node configuration ui to query for available openHAB items
    RED.httpNode.get('/openhab3/items', function (req, res) {
        var config = req.query;
        var url = getConnectionString(config) + '/rest/items';
        var options = getAuthorizationHeader(config);
        // console.log("Request to /openhab3/items with config " + JSON.stringify(config));
        ax.get(url, options)
            .then(response => {
                res.send(response.data);
            })
            .catch(error => {
                if (error.response) {
                    res.send("Request error http status: " + error.response.status + " for url " + url);
                } else {
                    res.send("Request error: " + error.message + " for url " + url);
                }
            });
    });

    /**
     * ====== openhab2-in2 ========================
     * Handles incoming openhab2 events, injecting
     * json into node-red flows, but with extra features
     * ===========================================
     */
    function OpenHABIn2(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        var node = this;
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid openHAB controller");
            return;
        }
        var itemName = config.itemname;
        var topic = config.topic;

        // node.log('OpenHABIn2, config: ' + JSON.stringify(config));

        this.refreshNodeStatus = function () {
            var currentState = node.context().get("currentState");

            if (currentState == null || typeof(currentState) !== 'string' || currentState.trim().length == 0 || currentState.toUpperCase() == OH_NULL) {
                node.status({
                    fill: "gray",
                    shape: "ring",
                    text: "state <not set>"
                });
            } else {
                var statusText = "state '" + currentState + "'; last updated at " + getLocalTime();
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: statusText
                });
            }
        };

        this.processInitialEvent = function (event) {
            // console.log("Node for itemName " + itemName + " retrieved InitialEvent: " + JSON.stringify(event));
            //"link":"http://openhab3-oauth2:8080/rest/items/TestString","state":"NULL","editable":false,"type":"String","name":"TestString","label":"String","tags":[],"groupNames":["GTest","GTest2"]}
            
            var currentState = event.state;
            // update node's context variable && update node's visual status
            node.context().set("currentState", currentState);
            node.refreshNodeStatus();

            // console.log("Node for itemName " + itemName + " config.initialstate: " + config.initialstate + " currentState: " + currentState);
            // only send the state when it is not OH_NULL and initialstate was selected from config.
            if (config.initialstate && shouldSendState(currentState)) {
                // inject the state in the node-red flow
                // console.log("Node for itemName " + itemName + " sendMessage() ");
                sendMessage(itemName, topic, 'InitialStateEvent', currentState, null);
            }
        };

        this.processRawEvent = function (event) {
            // inject the state in the node-red flow
            var eventType = event.type;
            var newState = event.payload.value;
            var oldValue = event.payload.oldValue;

            //only process state values not equal to NULL
            if (shouldSendState(newState)) {

                // update node's context variable && update node's visual status
                node.context().set("currentState", newState);

                // Use helper function to determine if we should send the new state
                if (evalSendMessage(config, eventType, oldValue, newState)) {
                    sendMessage(itemName, topic, eventType, newState, oldValue);
                }
                node.refreshNodeStatus();
            }
        };

        //start with an uninitialized state
        node.context().set('currentState', '');
        node.refreshNodeStatus();

        function sendMessage(itemName, topic, eventType, newState, oldValue) {
            // inject the state in the node-red flow
            var msg = {};
            //create new message to inject
            msg._msgid = RED.util.generateId();
            msg.item = itemName;
            msg.topic = topic;
            msg.event = eventType;
            msg.payload = newState;
            msg.oldValue = oldValue;
            node.send(msg);
        }

        function evalSendMessage(config, eventType, oldValue, newState) {
            if (config == null || eventType == null || newState == null) {
                return false;
            }

            // we never emit null/NULL values
            if (newState.toUpperCase() == OH_NULL) {
                return false;
            }
            var changedfrom = config.changedfrom;
            var changedto = config.changedto;

            if ((eventType == "ItemStateChangedEvent" || eventType == "GroupItemStateChangedEvent") && config.whenchanged &&
                (changedfrom == null || changedfrom.trim().length == 0 || (oldValue != null && oldValue.toUpperCase() == changedfrom.toUpperCase())) &&
                (changedto == null || changedto.trim().length == 0 || (newState != null && newState.toUpperCase() == changedto.toUpperCase()))) {
                return true;
            } else if (eventType == "ItemCommandEvent" && config.whencommand) {
                return true;
            } else if (eventType == "ItemStateEvent" && config.whenupdated) {
                return true;
            }
            // node.log("evalSendMessage: false");
            return false;
        }

        function getInitial() {
            //Actively get the initial item state
            openhabController.control(itemName, null, null,
                function (body) {
                    var currentState = body.state;

                    // update node's context variable
                    node.context().set("currentState", currentState);

                    // update node's visual status
                    node.refreshNodeStatus();

                    // only send the state when it is not OH_NULL and initialstate was selected from config.
                    if (config.initialstate && shouldSendState(currentState)) {
                        // inject the state in the node-red flow
                        sendMessage(itemName, topic, 'InitialStateEvent', currentState, null);
                    }
                },
                function (err) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: 'Error retrieving InitialStateEvent: ' + err
                    });
                    if (config.initialstate) {
                        node.warn(err);
                    }
                }
            );

            //Start listening to events, but only once for the node' lifetime
            openhabController.addListener(itemName + '/RawEvent', node.processRawEvent);
            openhabController.addListener(itemName + '/InitialEvent', node.processInitialEvent);
        }

        //Wait 0 to 5 seconds after startup before fetching initial value
        if (itemName != null) {
            setTimeout(getInitial, getRandomInt(1000, 5000));
        }

        /* ===== Node-Red events ===== */
        this.on("close", function () {
            node.log('close');
            openhabController.removeListener(itemName + '/InitialEvent', node.processInitialEvent);
            openhabController.removeListener(itemName + '/RawEvent', node.processRawEvent);
        });
    }

    RED.nodes.registerType("openhab2-in2", OpenHABIn2);

    /**
     * ====== openhab2-monitor ===================
     * Monitors connection status and errors of
     * the associated openhab2-controller2
     * ===========================================
     */
    function OpenHABMonitor(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        var node = this;
        var nrOfErrors = 0;
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid openHAB controller");
            return;
        }

        this.refreshNodeStatus = function () {
            var commStatus = node.context().get('CommunicationStatus');
            var commError = node.context().get('CommunicationError');

            node.status({
                fill: (commStatus == "ON") ? "green" : "red",
                shape: (commStatus == "ON") ? "dot" : "ring",
                text: (commError != null && typeof(commError) === 'string' && commError.length > 0) ? ("# " + nrOfErrors + ": " + trimString(commError, 40)) : commStatus
            });
        };

        this.processCommStatus = function (status) {

            // update node's context variable
            node.context().set('CommunicationStatus', status);

            // reset any error status after (re-)connecting
            if (status == 'ON') {
                nrOfErrors = 0;
                node.context().set('CommunicationError', '');
            }

            // update node's visual status
            node.refreshNodeStatus();

            // inject the state in the node-red flow (channel 1)
            var msgid = RED.util.generateId();
            node.send([{
                _msgid: msgid,
                payload: status,
                event: 'CommunicationStatus'
            }, null, null]);
        };

        this.processCommError = function (error) {

            // Update the number of errors
            nrOfErrors += 1;

            // update node's context variable
            node.context().set('CommunicationError', error);

            // update node's visual status
            node.refreshNodeStatus();

            // inject the error in the node-red flow (channel 2)
            var msgid = RED.util.generateId();
            node.send([null, {
                _msgid: msgid,
                payload: error,
                event: 'CommunicationError'
            }, null]);
        };

        this.processRawEvent = function (event) {
            // inject the state in the node-red flow (channel 3)
            var msgid = RED.util.generateId();
            node.send([null, null, {
                _msgid: msgid,
                payload: event,
                event: "RawEvent"
            }]);
        };

        openhabController.addListener('CommunicationStatus', node.processCommStatus);
        openhabController.addListener('CommunicationError', node.processCommError);
        openhabController.addListener('RawEvent', node.processRawEvent);
        node.context().set('CommunicationStatus', 'OFF');
        node.refreshNodeStatus();

        /* ===== Node-Red events ===== */
        this.on("close", function () {
            node.log('close');
            openhabController.removeListener('CommunicationStatus', node.processCommStatus);
            openhabController.removeListener('CommunicationError', node.processCommError);
            openhabController.removeListener('RawEvent', node.processRawEvent);
        });
    }

    RED.nodes.registerType("openhab2-monitor2", OpenHABMonitor);

    /**
     * ====== openhab2-out2 ===================
     * Sends outgoing commands or update from
     * messages received via node-red flows
     * It allows to conditionally save the state
     * only when it differs from the actual state.
     * =======================================
     */
    function OpenHABOut2(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        var node = this;
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid openHAB controller");
            return;
        }

        // node.log('new OpenHABOut, config: ' + JSON.stringify(config));

        function saveValue(item, topic, payload) {
            openhabController.control(item, topic, payload,
                function () {
                    // no body expected for a command or update
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "state '" + payload + "'; last written at " + getLocalTime()
                    });
                },
                function (err) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: err
                    });
                    node.warn(err);
                }
            );
        }

        // handle incoming node-red message
        this.on("input", function (msg) {

            // if a item/topic/payload is specified in the node's configuration, it overrides the item/topic/payload specified in the message
            var item = (config.itemname && (config.itemname.length != 0)) ? config.itemname : msg.item;
            var topic = (config.topic && (config.topic.length != 0)) ? config.topic : msg.topic;
            var payload = (config.payload && (config.payload.length != 0)) ? config.payload : msg.payload;
            var onlywhenchanged = config.onlywhenchanged;

            if (payload != null) {
                // execute the appropriate http POST to send the command to openHAB
                // and update the node's status according to the http response
                
                // Convert the payload to a String before sending, as any conversion will take place by OpenHAB.
                var payloadString = String(payload);

                if (onlywhenchanged) {
                    //Actively get the initial item state
                    openhabController.control(item, null, null,
                        function (body) {
                            //gather variables
                            var currentState = body.state;

                            if (currentState != null && payloadString != null && currentState != payloadString) {
                                saveValue(item, topic, payloadString);
                                node.status({
                                    fill: "green",
                                    shape: "dot",
                                    text: "state changed from '" + currentState + " ' to '" + payload + "')"
                                });
                                node.send(msg);
                            } else {
                                node.status({
                                    fill: "gray",
                                    shape: "ring",
                                    text: "state unchanged (already '" + currentState + "')"
                                });
                            }
                        },
                        function (err) {
                            node.status({
                                fill: "red",
                                shape: "ring",
                                text: err
                            });
                            node.warn(err);
                        }
                    );
                } else {
                    saveValue(item, topic, payloadString);
                    node.send(msg);
                }
            } else {
                // no payload specified !
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "No payload specified"
                });
                node.warn('onInput: no payload specified');
            }

        });
        this.on("close", function () {
            node.log('close');
        });
    }

    RED.nodes.registerType("openhab2-out2", OpenHABOut2);

    /**
     * ====== openhab2-get2 ===================
     * Actively retrieves the actual item state from openHAB
     * and sends it via the output.
     * ========================================
     */
    function OpenHABGet2(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        var node = this;
        var topic = config.topic;
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid openHAB controller");
            return;
        }

        this.refreshNodeStatus = function () {
            var currentState = node.context().get("currentState");

            if (!shouldSendStateForGet2(config.sendnull, currentState)) {
                node.status({
                    fill: "gray",
                    shape: "ring",
                    text: "state '" + currentState + "'; not sent"
                });
            } else {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "state '" + currentState + "'; last sent at " + getLocalTime()
                });
            }
        };

        // handle incoming node-red message
        this.on("input", function (msg) {

            var item = (config.itemname && (config.itemname.length != 0)) ? config.itemname : msg.item;

            openhabController.control(item, null, null,
                function (body) {
                    // "use esversion: 6'";
                    // no body expected for a command or update
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: " "
                    });

                    //var jsonBody = body;
                    var jsonBody = body;
                    var currentState = jsonBody.state;
                    var type = jsonBody.type;
                    var itemLabel = jsonBody.label;
                    var groups = jsonBody.groupNames;

                    // When we are dealing with an item of type "Group", we will also expose
                    // the members it contains via a .members property.
                    if (type == "Group") {
                        let grpMembers = {};
                        var membArr = body.members;
                        membArr.forEach(val => {
                            grpMembers = { ...grpMembers, [val.name]: val };
                        });
                        msg.members = grpMembers;
                    }

                    msg.item = item;
                    msg.label = itemLabel;
                    //only override the topic when it was not set from the config
                    if (topic) {
                        msg.topic = topic;
                    }
                    msg.event = "ActualValue";
                    msg.payload_in = msg.payload;
                    msg.payload = currentState;
                    msg.type = type;
                    msg.groups = groups;

                    // update node's context variable
                    node.context().set("currentState", currentState);

                    // update node's visual status
                    node.refreshNodeStatus();

                    // only send a message when the state is not OH_NULL, or when the
                    // sendnull config option is true.
                    if (shouldSendStateForGet2(config.sendnull, currentState)) {
                        node.send(msg);
                    }
                },
                function (err) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: err
                    });
                    node.warn(err);
                }
            );
        });
        this.on("close", function () {
            node.log('close');
        });
    }

    RED.nodes.registerType("openhab2-get2", OpenHABGet2);

    /**
     * ====== openhab2-events2 ===============
     * monitors openHAB events
     * =======================================
     */
    function OpenHABEvents(config) {

        RED.nodes.createNode(this, config);
        this.name = config.name;
        var node = this;
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid openHAB controller");
            return;
        }
        var config2 = openhabController.getConfig();
        // node.log("OpenHABEvents config: " + JSON.stringify(config2));

        function startEventSource() {

            // register for all item events
            var eventsource_url = config2.ohversion == "v3" ? "/rest/events?topics=" + V3_EVENTSOURCE_URL_PART + "/*/*" : "/rest/events?topics=" + V2_EVENTSOURCE_URL_PART + "/*/*";
            var sseUrl = getConnectionString(config2) + eventsource_url;
            var options = getAuthorizationHeader(config);
            // node.log('config.ohversion: ' + config2.ohversion + ' eventsource_url: ' + eventsource_url);
            node.es = new EventSource(sseUrl, options);

            node.status({
                fill: "gray",
                shape: "ring",
                text: " "
            });

            // handle the 'onopen' event
            node.es.onopen = function () {
                node.log("Opened connection to " + sseUrl);
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: ""
                });
            };

            // handle the 'onmessage' event
            node.es.onmessage = function (msg) {
                try {
                    // Only process SSE-events with type 'message'
                    if (msg.type != 'message') {
                        return;
                    }

                    // update the node status with the Item's new state
                    msg = JSON.parse(msg.data);
                    if (msg.payload && (msg.payload.constructor == String)) {
                        msg.payload = JSON.parse(msg.payload);
                        node.send(msg);
                    }
                } catch (e) {
                    // report an unexpected error
                    node.error("Unexpected Error : " + e);
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "Unexpected Error : " + e
                    });
                }
            };

            // handle the 'onerror' event
            node.es.onerror = function (err) {
                if (err.type && (JSON.stringify(err.type) === '{}'))
                    return; // ignore
                node.warn('Error: ' + stringifyAsJson(err, 150));
                node.debug('Error for url "' + sseUrl + '" with headers: ' + stringifyAsJson(options, 150) + ': ' + stringifyAsJson(err, 150));
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: 'Error for url "' + sseUrl + '": ' + stringifyAsJson(err, 50)
                });

                if (err.status) {
                    var errorStatus = parseInt(err.status);
                    var baseErrorStatus = Math.floor(errorStatus / 100);
                    if (baseErrorStatus == 4 || baseErrorStatus == 5) {
                        // the EventSource object has given up retrying ... retry reconnecting after 10 seconds
                        node.es.close();
                        delete node.es;

                        node.status({
                            fill: "red",
                            shape: "ring",
                            text: 'OFF'
                        });
                        
                        node.warn('Restarting EventSource (after delay)');
                        setTimeout(function () {
                            startEventSource();
                        }, 10000);
                    }
                }
            };
        }

        // give the system a few seconds
        setTimeout(function () {
            startEventSource();
        }, getRandomInt(1000, 5000));

        this.on("close", function () {
            node.log('close');
            node.es.close();
            delete node.es;
            node.status({
                fill: "red",
                shape: "ring",
                text: 'CommunicationStatus OFF'
            });
        });
    }

    RED.nodes.registerType("openhab2-events2", OpenHABEvents);
};
