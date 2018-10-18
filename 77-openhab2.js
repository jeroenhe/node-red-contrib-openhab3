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

var Rollbar = require('rollbar');
var rollbar = new Rollbar({
	accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
	captureUncaught: true,
	captureUnhandledRejections: true
});

var EventSource = require('@joeybaker/eventsource');
var request = require('request');
var OH_NULL = "NULL";
var oh_itemslist_cached = null;

function getConnectionString(config) {
	var url;

	if (config.protocol)
		url = config.protocol;
	else
		url = "http";

	url += "://";

	if ((config.username != undefined) && (config.username.trim().length != 0)) {
		url += config.username.trim();

		if ((config.password != undefined) && (config.password.length != 0)) {
			url += ":" + config.password;
		}
		url += "@";
	}
	url += config.host;

	if ((config.port != undefined) && (config.port.trim().length != 0)) {
		url += ":" + config.port.trim();
	}

	if ((config.path != undefined) && (config.path.trim().length != 0)) {
		var path = config.path.trim();

		path = path.replace(/^[\/]+/, '');
		path = path.replace(/[\/]+$/, '');

		url += "/" + path;
	}

	return url;
}

module.exports = function (RED) {

	/**
	 * ====== openhab2-controller ================
	 * Holds the hostname and port of the  
	 * openHAB server
	 * ===========================================
	 */
	function OpenHABControllerNode(config) {
		RED.nodes.createNode(this, config);

		this.getConfig = function () {
			return config;
		}

		var node = this;

		//node.log("OpenHABControllerNode config: " + JSON.stringify(config));

		// this controller node handles all communication with the configured openhab server
		function getStateOfItems(config) {
			//node.log("getStateOfItems : config = " + JSON.stringify(config));

			var url = getConnectionString(config) + "/rest/items";
			request.get(url, function (error, response, body) {
				// handle communication errors
				if (error) {
					node.warn("request error '" + error + "' on '" + url + "'");
					node.emit('CommunicationError', error);
				} else if (response.statusCode == 503) {
					// openhab not fully ready .... retry after 5 seconds
					node.warn("response status 503 on '" + url + "' .... retry later");
					node.emit('CommunicationError', response);
					setTimeout(function () {
						getStateOfItems(config);
					}, 5000);
				} else if (response.statusCode != 200) {
					node.warn("response error '" + JSON.stringify(response) + "' on '" + url + "'");
					node.emit('CommunicationError', response);
				} else {
					// update the registered nodes with item state
					node.emit('CommunicationStatus', "ON");

					var items = JSON.parse(body);

					items.forEach(function (item) {
						node.emit(item.name + "/StateEvent", {
							type: "ItemStateEvent",
							state: item.state
						});
					});

				}
			});

		}

		function startEventSource() {

			// record a generic message and send it to Rollbar
			rollbar.log("startEventSource()");

			// register for all item events

			node.es = new EventSource(getConnectionString(config) + "/rest/events?topics=smarthome/items", {});

			// handle the 'onopen' event

			node.es.onopen = function (event) {

				// get the current state of all items
				getStateOfItems(config);
			};

			// handle the 'onmessage' event

			node.es.onmessage = function (msg) {
				//node.log(msg.data);
				try {
					// update the node status with the Item's new state
					msg = JSON.parse(msg.data);
					msg.payload = JSON.parse(msg.payload);

					const itemStart = ("smarthome/items/").length;
					var item = msg.topic.substring(itemStart, msg.topic.indexOf('/', itemStart));

					node.emit(item + "/RawEvent", msg);
					node.emit("RawEvent", msg);

					if ((msg.type == "ItemStateEvent") || (msg.type == "ItemStateChangedEvent") || (msg.type == "GroupItemStateChangedEvent"))
						node.emit(item + "/StateEvent", {
							type: msg.type,
							state: msg.payload.value
						});

				} catch (e) {
					// report an unexpected error
					node.error("Unexpected Error : " + e)
				}

			};

			// handle the 'onerror' event

			node.es.onerror = function (err) {
				if (err.type && (JSON.stringify(err.type) === '{}'))
					return; // ignore

				node.warn('ERROR ' + JSON.stringify(err));
				node.emit('CommunicationError', JSON.stringify(err));

				if (err.status) {
					if ((err.status == 503) || (err.status == "503") || (err.status == 404) || (err.status == "404"))
						// the EventSource object has given up retrying ... retry reconnecting after 10 seconds
						node.es.close();
					delete node.es;

					node.emit('CommunicationStatus', "OFF");

					setTimeout(function () {
						startEventSource();
					}, 10000);
				} else if (err.type && err.type.code) {
					// the EventSource object is retrying to reconnect
				} else {
					// no clue what the error situation is
				}
			};

		}

		//startEventSource();
		// give the system a few seconds 
		setTimeout(function () {
			startEventSource();
		}, 5000);

		this.control = function (itemname, topic, payload, okCb, errCb) {
			var url;

			if (topic === "ItemUpdate") {
				url = getConnectionString(config) + "/rest/items/" + itemname + "/state";
				method = request.put;
			} else if (topic === "ItemCommand") {
				url = getConnectionString(config) + "/rest/items/" + itemname;
				method = request.post;
			} else {
				url = getConnectionString(config) + "/rest/items/" + itemname;
				method = request.get;
			}

			method({
				url: url,
				body: String(payload)
			}, function (error, response, body) {
				if (error) {
					node.emit('CommunicationError', error);
					errCb("request error '" + error + "' on '" + url + "'");
				} else if (Math.floor(response.statusCode / 100) != 2) {
					node.emit('CommunicationError', response);
					errCb("response error '" + JSON.stringify(response) + "' on '" + url + "'");
				} else {
					okCb(body);
				}
			});
		};

		this.on("close", function () {
			node.log('close');
			node.es.close();
			node.emit('CommunicationStatus', "OFF");
		});

	}
	RED.nodes.registerType("openhab2-controller", OpenHABControllerNode);

	// start a web service for enabling the node configuration ui to query for available openHAB items

	RED.httpNode.get("/openhab2/items", function (req, res, next) {
		//Very dirty but effective way to renew the items list approximately one in 10 times
		if (Math.floor(Math.random() * 10) == 0) {
			oh_itemslist_cached = null;
		}
		if (oh_itemslist_cached == null) {
			var config = req.query;
			var url = getConnectionString(config) + '/rest/items';
			request.get(url, function (error, response, body) {
				if (error) {
					res.send("request error '" + JSON.stringify(error) + "' on '" + url + "'");
					return;
				} else if (response.statusCode != 200) {
					res.send("response error '" + JSON.stringify(response) + "' on '" + url + "'");
					return;
				} else {
					oh_itemslist_cached = body;
				}
			});
		}
		return res.send(oh_itemslist_cached);
	});

	/**
	 * ====== openhab2-in ========================
	 * Handles incoming openhab2 events, injecting 
	 * json into node-red flows
	 * ===========================================
	 */
	function OpenHABIn(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var node = this;
		var openhabController = RED.nodes.getNode(config.controller);
		var itemName = config.itemname;

		if (itemName != undefined) itemName = itemName.trim();

		//node.log('OpenHABIn, config: ' + JSON.stringify(config));


		this.refreshNodeStatus = function () {
			var currentState = node.context().get("currentState");

			if (currentState == null)
				node.status({
					fill: "yellow",
					shape: "ring",
					text: "state: " + currentState
				});
			else if (currentState == "ON" || currentState == "OPEN")
				node.status({
					fill: "green",
					shape: "dot",
					text: "state: " + currentState
				});
			else if (currentState == "OFF" || currentState == "CLOSED")
				node.status({
					fill: "green",
					shape: "ring",
					text: "state: " + currentState
				});
			else
				node.status({
					fill: "blue",
					shape: "ring",
					text: "state: " + currentState
				});
		};

		this.processStateEvent = function (event) {

			var currentState = node.context().get("currentState");

			if ((event.state != currentState) && (event.state != "null")) {
				// update node's context variable
				currentState = event.state;
				node.context().set("currentState", currentState);

				// update node's visual status
				node.refreshNodeStatus();

				// inject the state in the node-red flow
				var msgid = RED.util.generateId();
				node.send([{
					_msgid: msgid,
					payload: currentState,
					item: itemName,
					event: "StateEvent"
				}, null]);

			}
		};

		this.processRawEvent = function (event) {
			// inject the state in the node-red flow
			var msgid = RED.util.generateId();
			node.send([null, {
				_msgid: msgid,
				payload: event,
				item: itemName,
				event: "RawEvent"
			}]);
		};

		node.context().set("currentState", "?");
		openhabController.addListener(itemName + '/RawEvent', node.processRawEvent);
		openhabController.addListener(itemName + '/StateEvent', node.processStateEvent);
		node.refreshNodeStatus();

		/* ===== Node-Red events ===== */
		this.on("input", function (msg) {
			if (msg != null) {

			};
		});
		this.on("close", function () {
			node.log('close');
			openhabController.removeListener(itemName + '/StateEvent', node.processStateEvent);
			openhabController.removeListener(itemName + '/RawEvent', node.processRawEvent);
		});

	}
	//
	RED.nodes.registerType("openhab2-in", OpenHABIn);

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
		var itemName = config.itemname;
		var topic = config.topic;
		var initialstate = config.initialstate;
		var onlywhenchanged = config.onlywhenchanged;
		var changedfrom = config.changedfrom;
		var changedto = config.changedto;
		var keepsending = config.keepsending;
		var keepsending_payload = config.keepsendingpayload;
		var keepsending_seconds = config.keepsendingseconds;

		if (itemName != undefined) {
			itemName = itemName.trim();
		}

		//node.log('OpenHABIn2, config: ' + JSON.stringify(config));

		this.refreshNodeStatus = function () {
			var currentState = node.context().get("currentState");

			if (currentState == null || currentState == undefined || (currentState != null && currentState != undefined && currentState.trim().length == 0) || (currentState != null && currentState != undefined && currentState.toUpperCase() == OH_NULL)) {
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

		var runner = null;

		this.processRawEvent = function (event) {
			/* 	event: message
				data: {"topic":"smarthome/items/NachtelijkGasVerbruik/statechanged","payload":"{\"type\":\"Decimal\",\"value\":\"4144.781\",\"oldType\":\"Decimal\",\"oldValue\":\"4144.588\"}","type":"ItemStateChangedEvent"}
			*/
			// inject the state in the node-red flow
			var eventType = event.type;
			var newState = event.payload.value;
			var oldValue = event.payload.oldValue;
			
			//only process state values not equal to NULL
			if (newState != null && newState != undefined && newState.toUpperCase() != OH_NULL) {

				// update node's context variable && update node's visual status
				node.context().set("currentState", newState);
				node.refreshNodeStatus();

				var repeatEnabled = evalRepeat(config, newState, keepsending, keepsending_payload, keepsending_seconds);
				if (!repeatEnabled && runner != null) {
					clearInterval(runner);
				}

				// Use helper function to determine if we should send the new state
				if (evalSendMessage(config, eventType, oldValue, newState)) {
					sendMessage(itemName, topic, eventType, newState, oldValue, "0");

					// Prepare for repeating message
					if (repeatEnabled && runner == null) { 
						keepsending_ms = parseInt(keepsending_seconds) * 1000;
						runner = setInterval(
							function(){ sendMessage(itemName, topic, eventType, newState, oldValue, "1"); }, 
							keepsending_ms
						);
					}
				}
			} else {
				node.log("Not processing null state for item " + itemName + " and eventType" + eventType);
			}
		};

		//start with an unitialized state
		node.context().set("currentState", "");
		node.refreshNodeStatus();

		function sendMessage(itemName, topic, eventType, newState, oldValue, repeat) {
			// inject the state in the node-red flow
			var msg = {};
			//create new message to inject
			msg._msgid = RED.util.generateId();
			msg.item = itemName;
			msg.topic = topic;
			msg.event = eventType;
			msg.payload = newState;
			msg.oldValue = oldValue;
			msg.repeat = repeat;
			node.send(msg);			
		}

		function evalRepeat(config, newState, keepsending, keepsending_payload, keepsending_seconds) {
			if (config == null || newState == null) {
				return false;
			}
			if (keepsending != null && keepsending != undefined && keepsending && 
				newState != null && newState != undefined && 
				keepsending_payload != null && keepsending_payload != undefined &&
				keepsending_seconds != null && keepsending_seconds != undefined &&
				newState.toUpperCase() == keepsending_payload.toUpperCase()) 
			{ 
				return true;
			}
			return false;
		}

		function evalSendMessage(config, eventType, oldValue, newState, repeat) {
			if (config == null || eventType == null || newState == null) {
				return false;
			}
			var initialstate = config.initialstate;
			var onlywhenchanged = config.onlywhenchanged;
			var changedfrom = config.changedfrom;
			var changedto = config.changedto;

			if ((eventType == "ItemStateChangedEvent" || eventType == "ItemCommandEvent") 
				&& config.whenchanged 
				&& (changedfrom == null || changedfrom == undefined || changedfrom.trim().length == 0 || (oldValue != null && oldValue != undefined && oldValue.toUpperCase() == changedfrom.toUpperCase()))
				&& (changedto == null || changedto == undefined || changedto.trim().length == 0 || (newState != null && newState != undefined && newState.toUpperCase() == changedto.toUpperCase()))) {
				//node.log("evalSendMessage: true for ItemStateChangedEvent");
				return true;
			} else if (eventType == "ItemStateEvent" && config.whenupdated)
			{
				//node.log("evalSendMessage: true for ItemStateEvent");
				return true;
			}
			//node.log("evalSendMessage: false");
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

					if (config.initialstate) {
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

		//Wait 1 seconds after startup before fetching initial value
		setTimeout(getInitial, 1000);

		/* ===== Node-Red events ===== */
		this.on("input", function (msg) {
			if (msg != null) {

			};
		});
		this.on("close", function () {
			node.log('close');
			openhabController.removeListener(itemName + '/RawEvent', node.processRawEvent);
		});

	}
	//
	RED.nodes.registerType("openhab2-in2", OpenHABIn2);

	/**
	 * ====== openhab2-monitor ===================
	 * Monitors connection status and errors of
	 * the associated openhab2-controller
	 * ===========================================
	 */
	function OpenHABMonitor(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var node = this;
		var openhabController = RED.nodes.getNode(config.controller);

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
			if (status == "ON")
				node.context().set("CommunicationError", "");

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
		this.on("input", function (msg) {
			if (msg != null) {

			};
		});
		this.on("close", function () {
			node.log('close');
			openhabController.removeListener('CommunicationStatus', node.processCommStatus);
			openhabController.removeListener('CommunicationError', node.processCommError);
			openhabController.removeListener('RawEvent', node.processRawEvent);
		});

	}
	//
	RED.nodes.registerType("openhab2-monitor", OpenHABMonitor);


	/**
	 * ====== openhab2-out ===================
	 * Sends outgoing commands or update from
	 * messages received via node-red flows
	 * =======================================
	 */
	function OpenHABOut(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var openhabController = RED.nodes.getNode(config.controller);
		var node = this;

		//node.log('new OpenHABOut, config: ' + JSON.stringify(config));

		// handle incoming node-red message
		this.on("input", function (msg) {

			// if a item/topic/payload is specified in the node's configuration, it overrides the item/topic/payload specified in the message
			var item = (config.itemname && (config.itemname.length != 0)) ? config.itemname : msg.item;
			var topic = (config.topic && (config.topic.length != 0)) ? config.topic : msg.topic;
			var payload = (config.payload && (config.payload.length != 0)) ? config.payload : msg.payload;

			if (payload != undefined) {
				// execute the appropriate http POST to send the command to openHAB
				// and update the node's status according to the http response

				openhabController.control(item, topic, payload,
					function (body) {
						// no body expected for a command or update
						node.status({
							fill: "green",
							shape: "dot",
							text: " "
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
	//
	RED.nodes.registerType("openhab2-out", OpenHABOut);

	/**
	 * ====== openhab2-out2 ===================
	 * Sends outgoing commands or update from
	 * messages received via node-red flows
	 * It allows to save the state when it differs
	 * from the latest.
	 * =======================================
	 */
	function OpenHABOut2(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var openhabController = RED.nodes.getNode(config.controller);
		var node = this;

		//node.log('new OpenHABOut, config: ' + JSON.stringify(config));

		function saveValue(item, topic, payload) {
			openhabController.control(item, topic, payload,
				function (body) {
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
	//
	RED.nodes.registerType("openhab2-out2", OpenHABOut2);

	/**
	 * ====== openhab2-get ===================
	 * Gets the item data when
	 * messages received via node-red flows
	 * =======================================
	 */
	function OpenHABGet(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var openhabController = RED.nodes.getNode(config.controller);
		var node = this;

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
					msg.payload_in = msg.payload;
					msg.payload = JSON.parse(body);
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
	//
	RED.nodes.registerType("openhab2-get", OpenHABGet);

	/**
	 * ====== openhab2-get2 ===================
	 * Gets the item data when
	 * messages received via node-red flows
	 * =======================================
	 */
	function OpenHABGet2(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var topic = config.topic;
		var openhabController = RED.nodes.getNode(config.controller);
		var node = this;

		this.refreshNodeStatus = function () {
			var currentState = node.context().get("currentState");

			if (currentState == null || currentState == undefined || (currentState != null && currentState != undefined && currentState.trim().length == 0) || (currentState != null && currentState != undefined && currentState.toUpperCase() == OH_NULL)) {
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

					//update msg
					msg.item = item;
					msg.topic = topic;
					msg.event = "ActualValue";
					msg.payload = currentState;
					msg.oldValue = null;

					// update node's context variable
					node.context().set("currentState", currentState);

					// update node's visual status
					node.refreshNodeStatus();

					msg.payload_in = msg.payload;
					msg.payload = currentState
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
	//
	RED.nodes.registerType("openhab2-get2", OpenHABGet2);

	/**
	 * ====== openhab2-events ===================
	 * monitors opnHAB events
	 * =======================================
	 */
	function OpenHABEvents(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		var openhabController = RED.nodes.getNode(config.controller);
		var node = this;

		function startEventSource() {

			if (openhabController == null) {
				node.error("Invalid controller");
				return;
			}

			// register for all item events

			node.es = new EventSource(getConnectionString(openhabController.getConfig()) + "/rest/events?topics=smarthome/*/*", {});

			// handle the 'onopen' event

			node.status({
				fill: "green",
				shape: "ring",
				text: " "
			});

			node.es.onopen = function (event) {
				node.status({
					fill: "green",
					shape: "dot",
					text: " "
				});
			};

			// handle the 'onmessage' event

			node.es.onmessage = function (msg) {
				//node.log(msg.data);
				try {
					// update the node status with the Item's new state
					msg = JSON.parse(msg.data);
					if (msg.payload && (msg.payload.constructor == String))
						msg.payload = JSON.parse(msg.payload);
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

				node.warn('ERROR ' + JSON.stringify(err));
				node.status({
					fill: "red",
					shape: "dot",
					text: 'CommunicationError ' + JSON.stringify(err)
				});


				if (err.status) {
					if ((err.status == 503) || (err.status == "503") || (err.status == 404) || (err.status == "404"))
						// the EventSource object has given up retrying ... retry reconnecting after 10 seconds

						node.es.close();
					delete node.es;

					node.status({
						fill: "red",
						shape: "dot",
						text: 'CommunicationStatus OFF'
					});

					setTimeout(function () {
						startEventSource();
					}, 10000);
				} else if (err.type && err.type.code) {
					// the EventSource object is retrying to reconnect
				} else {
					// no clue what the error situation is
				}
			};

		}

		//startEventSource();
		// give the system few seconds 
		setTimeout(function () {
			startEventSource();
		}, 5000);

		this.on("close", function () {
			node.log('close');
			node.es.close();
			node.status({
				fill: "red",
				shape: "dot",
				text: 'CommunicationStatus OFF'
			});

		});

	}
	//
	RED.nodes.registerType("openhab2-events", OpenHABEvents);
}