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

var EventSource = require('@joeybaker/eventsource');
var request = require('request');

var OH_NULL = 'NULL';
var V2_EVENTSOURCE_URL_PART = 'smarthome';
var V3_EVENTSOURCE_URL_PART = 'openhab';


function getConnectionString(config) {
    var url;

    if (config.protocol)
        url = config.protocol;
    else
        url = 'http';

    url += '://';

    // Only set username and password inside the url when BOTH username and
    // password are provided and non-empty.
    if ((config.username != undefined) && (config.username.trim().length != 0) && 
        (config.password != undefined) && (config.password.length != 0)) {
            url += encodeURIComponent(config.username.trim());
            url += ':' + encodeURIComponent(config.password);
            url += '@';
    }
    url += config.host;

    if ((config.port != undefined) && (config.port.trim().length != 0)) {
        url += ':' + config.port.trim();
    }

    if ((config.path != undefined) && (config.path.trim().length != 0)) {
        var path = config.path.trim();

        path = path.replace(/^[\/]+/, '');
        path = path.replace(/[\/]+$/, '');

        url += '/' + path;
    }
    return url;
}

function trimString(string, length) {
    return string.length > length ?
        string.substring(0, length - 3) + '...' :
        string;
}

function getAuthenticationHeader(config) {
    var options = {};
    if (config != undefined && config.token != undefined && config.token.length != 0) {
        options.headers = {
            Authorization: 'Bearer ' + config.token
        }
    }
    return options;
}

function shouldSendState(state) {
    return state != null && state != undefined && state.toUpperCase() != OH_NULL;
}

function getRandomInt(lower, upper) {
    if (lower > upper || lower < 0 || upper < 1) {
        return 0;
    }
    return parseInt(Math.random() * (upper - lower)) + lower;
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
        }

        // node.log("OpenHABControllerNode config: " + JSON.stringify(config));

        // this controller node handles all communication with the configured openhab server
        function getStateOfItems(config) {
            //node.log("getStateOfItems : config = " + JSON.stringify(config));

            var url = getConnectionString(config) + "/rest/items";
            var options = getAuthenticationHeader(config)
            request.get(url, options, function (error, response, body) {
                // handle communication errors
                if (error) {
                    node.warn('request error ' + trimString(JSON.stringify(response), 50) + ' on ' + url);
                    node.emit('CommunicationError', error);
                } else if (response.statusCode == 503) {
                    // openhab not fully ready .... retry after 5 seconds
                    node.warn("response status 503 on '" + url + "' ... retry later");
                    node.emit('CommunicationError', response);
                    setTimeout(function () {
                        getStateOfItems(config);
                    }, 5000);
                } else if (response.statusCode != 200) {
                    node.warn('response error ' + trimString(JSON.stringify(response), 50) + ' on ' + url);
                    node.emit('CommunicationError', response);
                } else {
                    // update the registered nodes with item state
                    node.emit('CommunicationStatus', 'ON');

                    var items = JSON.parse(body);

                    items.forEach(function (item) {
                        node.emit(item.name + '/StateEvent', {
                            type: 'ItemStateEvent',
                            state: item.state
                        });
                    });
                }
            });
        }

        function startEventSource() {

            // register for all item events
            var eventsource_url = config.ohversion == 'v3' ? '/rest/events?topics=openhab/items' : '/rest/events?topics=smarthome/items';

            // node.log('config.ohversion: ' + config.ohversion + ' eventsource_url: ' + eventsource_url);
            node.es = new EventSource(getConnectionString(config) + eventsource_url, {});

            // handle the 'onopen' event
            node.es.onopen = function () {
                // get the current state of all items
                getStateOfItems(config);
            };

            // handle the 'onmessage' event
            node.es.onmessage = function (msg) {
                // node.log(msg.data);
                try {
                    // update the node status with the Item's new state
                    msg = JSON.parse(msg.data);
                    msg.payload = JSON.parse(msg.payload);

                    var url = V2_EVENTSOURCE_URL_PART + '/items/';
                    if (config.ohversion === 'v3') {
                        url = V3_EVENTSOURCE_URL_PART + '/items/';
                    }
                    // node.log('config.ohversion: ' + config.ohversion + ' url: ' + url);
                    const itemStart = (url).length;
                    var item = msg.topic.substring(itemStart, msg.topic.indexOf('/', itemStart));

                    node.emit(item + '/RawEvent', msg);
                    node.emit('RawEvent', msg);

                    if ((msg.type == 'ItemStateEvent') || (msg.type == 'ItemStateChangedEvent') || (msg.type == 'GroupItemStateChangedEvent'))
                        node.emit(item + '/StateEvent', {
                            type: msg.type,
                            state: msg.payload.value
                        });

                } catch (e) {
                    // report an unexpected error
                    node.error('Unexpected Error : ' + e)
                }
            };

            // handle the 'onerror' event
            node.es.onerror = function (err) {
                if (err.type && (JSON.stringify(err.type) === '{}'))
                    return; // ignore

                node.warn('ERROR ' + trimString(JSON.stringify(err), 50));
                node.emit('CommunicationError', JSON.stringify(err));

                if (err.status) {
                    var errorStatus = parseInt(err.status)
                    var baseErrorStatus = Math.floor(errorStatus / 100)
                    if (baseErrorStatus == 4 || baseErrorStatus == 5) {
                        // the EventSource object has given up retrying ... retry reconnecting after 10 seconds
                        node.es.close();
                        delete node.es;

                        node.emit('CommunicationStatus', 'OFF');

                        setTimeout(function () {
                            node.warn('Restarting EventSource (after delay)');
                            startEventSource();
                        }, 10000);
                    }
                } else if (err.type && err.type.code) {
                    // the EventSource object is retrying to reconnect
                } else {
                    // no clue what the error situation is
                }
            };
        }

        // give the system a few random seconds before starting to process the event stream
        setTimeout(function () {
            startEventSource();
        }, getRandomInt(1000, 5000));

        this.control = function (itemname, topic, payload, okCb, errCb) {
            var url;
            var headers = {
                "Content-type": "text/plain"
            };
            var method = request.get;

            if (topic === "ItemUpdate") {
                url = getConnectionString(config) + "/rest/items/" + itemname + "/state";
                method = request.put;
            } else if (topic === "ItemCommand") {
                url = getConnectionString(config) + "/rest/items/" + itemname;
                method = request.post;
            } else {
                url = getConnectionString(config) + "/rest/items/" + itemname;
                headers = {};
                method = request.get;
            }

            method({
                url: url,
                body: String(payload),
                headers: headers
            }, function (error, response, body) {
                if (error) {
                    node.emit('CommunicationError', error);
                    errCb("request error '" + trimString(error, 50) + "' on '" + url + "'");
                } else if (Math.floor(response.statusCode / 100) != 2) {
                    node.emit('CommunicationError', response);
                    errCb("response error '" + trimString(JSON.stringify(response), 50) + "' on '" + url + "'");
                } else {
                    okCb(body);
                }
            });
        };

        this.on("close", function () {
            node.log('close');
            node.es.close();
            delete node.es;
            node.emit('CommunicationStatus', "OFF");
        });
    }
    RED.nodes.registerType("openhab2-controller2", OpenHABControllerNode);

    // start a web service for enabling the node configuration ui to query for available openHAB items
    RED.httpNode.get('/openhab2/items', function (req, res) {
        var config = req.query;
        var url = getConnectionString(config) + '/rest/items';
        var options = getAuthenticationHeader(config);
        request.get(url, options, function (error, response, body) {
            if (error) {
                res.send("request error '" + trimString(JSON.stringify(error), 50) + "' on '" + url + "'");
            } else if (response.statusCode != 200) {
                res.send("response error '" + trimString(JSON.stringify(response), 50) + "' on '" + url + "'");
            } else {
                res.send(body);
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
            node.error("Invalid OpenHAB controller");
            return;
        }
        var itemName = config.itemname;
        var topic = config.topic;

        // node.log('OpenHABIn2, config: ' + JSON.stringify(config));

        this.refreshNodeStatus = function () {
            var currentState = node.context().get("currentState");

            if (currentState == null || currentState == undefined || (currentState != null && currentState != undefined && currentState.trim().length == 0) || (currentState != null && currentState != undefined && currentState.toUpperCase() == OH_NULL)) {
                node.status({
                    fill: "gray",
                    shape: "ring",
                    text: "state: " + currentState
                });
            } else {
                var statusText = "state: " + currentState;
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: statusText
                });
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

        //start with an unitialized state
        node.context().set("currentState", "");
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
                (changedfrom == null || changedfrom == undefined || changedfrom.trim().length == 0 || (oldValue != null && oldValue != undefined && oldValue.toUpperCase() == changedfrom.toUpperCase())) &&
                (changedto == null || changedto == undefined || changedto.trim().length == 0 || (newState != null && newState != undefined && newState.toUpperCase() == changedto.toUpperCase()))) {
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
                    //gather variables
                    var msg = {};
                    var msgid = RED.util.generateId();
                    var currentState = JSON.parse(body).state;

                    //create new message to inject
                    msg._msgid = msgid;
                    msg.item = itemName;
                    msg.topic = topic;
                    msg.event = "InitialStateEvent";
                    msg.payload = currentState;
                    msg.oldValue = null;

                    // update node's context variable
                    node.context().set("currentState", currentState);

                    // update node's visual status
                    node.refreshNodeStatus();

                    // only send the state when it is not OH_NULL
                    if (config.initialstate && shouldSendState(currentState)) {
                        // inject the state in the node-red flow
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

            //Start listening to events
            openhabController.addListener(itemName + '/RawEvent', node.processRawEvent);
        }

        //Wait 0..5 seconds after startup before fetching initial value
        if (itemName != null && itemName != undefined) {
            setTimeout(getInitial, getRandomInt(1000, 5000));
        }

        /* ===== Node-Red events ===== */
        this.on("close", function () {
            node.log('close');
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
        var openhabController = RED.nodes.getNode(config.controller);
        if (openhabController == null) {
            node.error("Invalid OpenHAB controller");
            return;
        }

        this.refreshNodeStatus = function () {
            var commError = node.context().get("CommunicationError");
            var commStatus = node.context().get("CommunicationStatus");

            node.status({
                fill: (commError.length == 0) ? "green" : "red",
                shape: (commStatus == "ON") ? "dot" : "ring",
                text: (commError.length != 0) ? commError : commStatus
            });
        };

        this.processCommStatus = function (status) {

            // update node's context variable
            node.context().set("CommunicationStatus", status);
            if (status == "ON") {
                node.context().set("CommunicationError", "");
            }

            // update node's visual status
            node.refreshNodeStatus();

            // inject the state in the node-red flow (channel 1)
            var msgid = RED.util.generateId();
            node.send([{
                _msgid: msgid,
                payload: status,
                event: "CommunicationStatus"
            }, null, null]);
        };

        this.processCommError = function (error) {

            // update node's context variable
            node.context().set("CommunicationError", JSON.stringify(error));

            // update node's visual status
            node.refreshNodeStatus();

            // inject the error in the node-red flow (channel 2)
            var msgid = RED.util.generateId();
            node.send([null, {
                _msgid: msgid,
                payload: error,
                event: "CommunicationError"
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
        node.context().set("CommunicationError", "");
        node.context().set("CommunicationStatus", "?");
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
            node.error("Invalid OpenHAB controller");
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
                        text: "status ('" + payload + "') written"
                    });
                },
                function (err) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: err
                    });
                    node.warn(String(err));
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

            if (payload != undefined) {
                // execute the appropriate http POST to send the command to openHAB
                // and update the node's status according to the http response

                if (onlywhenchanged) {
                    //Actively get the initial item state
                    openhabController.control(item, null, null,
                        function (body) {
                            //gather variables
                            var currentState = JSON.parse(body).state;

                            if (currentState != undefined && currentState != null && payload != undefined && payload != null && currentState != payload) {
                                saveValue(item, topic, payload);
                                node.status({
                                    fill: "green",
                                    shape: "ring",
                                    text: "status written (changed from  '" + currentState + " ' to '" + payload + "')"
                                });
                            } else {
                                node.status({
                                    fill: "gray",
                                    shape: "ring",
                                    text: "status unchanged (already '" + currentState + "')"
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
                    saveValue(item, topic, payload);
                }

            } else {
                // no payload specified !
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "no payload specified"
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
            node.error("Invalid OpenHAB controller");
            return;
        }

        this.refreshNodeStatus = function () {
            var currentState = node.context().get("currentState");

            if (!shouldSendState(currentState)) {
                node.status({
                    fill: "gray",
                    shape: "ring",
                    text: "state: " + currentState
                });
            } else {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "state: " + currentState
                });
            }
        };

        // handle incoming node-red message
        this.on("input", function (msg) {

            var item = (config.itemname && (config.itemname.length != 0)) ? config.itemname : msg.item;

            openhabController.control(item, null, null,
                function (body) {
                    // no body expected for a command or update
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: " "
                    });

                    var currentState = JSON.parse(body).state;
                    var type = JSON.parse(body).type;
                    var itemLabel = JSON.parse(body).label;
                    var groups = JSON.parse(body).groupNames;
      
                    // When we are dealing with an item of type "Group", we will also expose
                    // the members it contains via a .members property.
                    if (type == "Group") {
                        let grpMembers = {};
                        var membArr = JSON.parse(body).members;
                        membArr.forEach(val => {
                            grpMembers = { ...grpMembers, [val.name]: val };
                        });
                        msg.members = grpMembers;
                    }

                    msg.item = item;
                    msg.label = itemLabel;
                    msg.topic = topic;
                    msg.event = "ActualValue";
                    msg.payload_in = msg.payload;
                    msg.payload = currentState;
                    msg.type = type;
                    msg.groups = groups;

                    // update node's context variable
                    node.context().set("currentState", currentState);

                    // update node's visual status
                    node.refreshNodeStatus();
                    node.send(msg);
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
            node.error("Invalid OpenHAB controller");
            return;
        }
        var config2 = openhabController.getConfig()
        // node.log("OpenHABEvents config: " + JSON.stringify(config2));

        function startEventSource() {

            // register for all item events
            var eventsource_url = config2.ohversion == "v3" ? "/rest/events?topics=" + V3_EVENTSOURCE_URL_PART + "/*/*" : "/rest/events?topics=" + V2_EVENTSOURCE_URL_PART + "/*/*";
            // node.log('config.ohversion: ' + config2.ohversion + ' eventsource_url: ' + eventsource_url);
            node.es = new EventSource(getConnectionString(config2) + eventsource_url, {});

            node.status({
                fill: "green",
                shape: "ring",
                text: " "
            });

            // handle the 'onopen' event
            node.es.onopen = function () {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: " "
                });
            };

            // handle the 'onmessage' event
            node.es.onmessage = function (msg) {
                // node.log(msg.data);
                try {
                    // update the node status with the Item's new state
                    msg = JSON.parse(msg.data);
                    if (msg.payload && (msg.payload.constructor == String)) {
                        msg.payload = JSON.parse(msg.payload);
                    }
                    node.send(msg);
                } catch (e) {
                    // report an unexpected error
                    node.error("Unexpected Error : " + e)
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "Unexpected Error : " + e
                    });
                }
            };

            // handle the 'onerror' event
            node.es.onerror = function (err) {
                if (err.type && (JSON.stringify(err.type) === '{}'))
                    return; // ignore

                node.warn('ERROR ' + trimString(JSON.stringify(err), 50));
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: 'CommunicationError ' + trimString(JSON.stringify(err), 50)
                });

                if (err.status) {
                    var errorStatus = parseInt(err.status)
                    var baseErrorStatus = Math.floor(errorStatus / 100)
                    if (baseErrorStatus == 4 || baseErrorStatus == 5) {
                        // the EventSource object has given up retrying ... retry reconnecting after 10 seconds
                        node.es.close();
                        delete node.es;

                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: 'CommunicationStatus OFF'
                        });

                        setTimeout(function () {
                            node.warn('Restarting EventSource (after delay)');
                            startEventSource();
                        }, 10000);
                    }
                } else if (err.type && err.type.code) {
                    // the EventSource object is retrying to reconnect
                } else {
                    // no clue what the error situation is
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
                shape: "dot",
                text: 'CommunicationStatus OFF'
            });
        });
    }

    RED.nodes.registerType("openhab2-events2", OpenHABEvents);
}