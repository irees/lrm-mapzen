(function () {
  'use strict';

  var L = require('leaflet');
  var corslite = require('@mapbox/corslite');
  var polyline = require('@mapbox/polyline');

  module.exports = L.Class.extend({
    options: {
      serviceUrl: 'http://localhost:8000/otp/routers/default',
      timeout: 30 * 1000
    },
    initialize: function (accessToken, options) {
      L.Util.setOptions(this, options);
      this.options.routingOptions = {};
      for (var key in options) {
        if (key !== 'serviceUrl' || key !== 'timeout') {
          this.options.routingOptions[key] = options[key];
        }
      }
      this._accessToken = accessToken;
    },
    route: function (waypoints, callback, context, options) {
      var timedOut = false,
        wps = [],
        url,
        timer,
        wp,
        i;
      var routingOptions = L.extend(this.options.routingOptions, options);

      url = this.buildRouteUrl(waypoints, routingOptions);
      timer = setTimeout(function () {
        timedOut = true;
        callback.call(context || callback, {
          status: -1,
          message: 'Time out.'
        });
      }, this.options.timeout);
      // Create a copy of Waypoints
      for (i = 0; i < waypoints.length; i++) {
        wp = waypoints[i];
        wps.push(new L.Routing.Waypoint(L.latLng(wp.latLng), wp.name || "", wp.options || {}))
      }
      // Make routing request
      corslite(url, L.bind(function (err, resp) {
        var data;
        clearTimeout(timer);
        if (!timedOut) {
          if (!err) {
            data = JSON.parse(resp.responseText);
            this._routeDone(data, wps, routingOptions, callback, context);
          } else {
            console.log("Error : " + err.response);
            callback.call(context || callback, {
              status: err.status,
              message: err.response
            });
          }
        }
      }, this), true);
      return this;
    },

    _routeDone: function (response, inputWaypoints, routingOptions, callback, context) {
      var coordinates,
        alts,
        outputWaypoints,
        i;
      context = context || callback;
      console.log(response);
      if (response.error) {
        callback.call(context, {
          status: response.status,
          message: response.status_message
        });
        return;
      }
      // Parse response
      var itin = response.plan.itineraries[0];
      var insts = [];
      var coordinates = [];
      var shapeIndex = 0;
      for (var i = 0; i < itin.legs.length; i++) {
        var [coords, leginsts] = this._convertLeg(itin.legs[i]);
        // Leg instruction indexes are relative to that leg
        for (var j = 0; j < leginsts.length; j++) {
          leginsts[j].index += shapeIndex;
        }
        coordinates = coordinates.concat(coords);
        insts = insts.concat(leginsts);
        shapeIndex += coords.length;
      }
      outputWaypoints = this._toWaypoints([response.plan.from, response.plan.to]);
      alts = [{
        name: "Trip Name Goes Here",
        summary: this._convertSummary(itin),
        coordinates: coordinates,
        instructions: insts,
        //
        unit: "m", // response.trip.units,
        costing: routingOptions.costing,
        subRoutes: null,
        inputWaypoints: inputWaypoints,
        outputWaypoints: outputWaypoints,
        waypointIndices: null
      }];
      callback.call(context, null, alts);
    },

    _toWaypoints: function (vias) {
      var wps = [],
        i;
      for (i = 0; i < vias.length; i++) {
        var etcInfo = {};
        for (var key in vias[i]) {
          if (key !== 'lat' && key !== 'lon') {
            etcInfo[key] = vias[i][key];
          }
        }
        wps.push(new L.Routing.Waypoint(L.latLng([vias[i]["lat"], vias[i]["lon"]]),
          null,
          etcInfo));
      }
      return wps;
    },

    buildRouteUrl: function (waypoints, options) {
      var locs = [];
      for (var i = 0; i < waypoints.length; i++) {
        var loc = {
          lat: waypoints[i].latLng.lat,
          lon: waypoints[i].latLng.lng,
        }
        for (var key in waypoints[i].options) {
          if (waypoints[i].options[key]) loc[key] = waypoints[i].options[key];
        }
        locs.push(loc);
      }
      if (locs.length < 2) {
        console.log("need at least 2 waypoints");
      }
      var paramsToPass = L.extend(options, { fromPlace: this._locationKey(locs[0]), toPlace: this._locationKey(locs[1]) });
      var queryString = Object.keys(paramsToPass).map(key => key + '=' + paramsToPass[key]).join('&');
      return this.options.serviceUrl + 'plan?' + queryString;
    },

    _locationKey: function (location) {
      return location.lat + ',' + location.lon;
    },

    _trimLocationKey: function (location) {
      var nameLat = Math.floor(location.lat * 1000) / 1000;
      var nameLng = Math.floor(location.lng * 1000) / 1000;
      return nameLat + ' , ' + nameLng;
    },

    _convertSummary: function (route) {
      var d = 0.0;
      route.legs.forEach((leg) => {
        d += leg.distance
      });
      return {
        totalDistance: d,
        totalTime: route.duration
      };
    },

    _convertLeg: function(leg) {
      var insts = [];
      var coordinates = [];
      var coords = polyline.decode(leg.legGeometry.points, 5);      
      for (var k = 0; k < coords.length; k++) {
        coordinates.push(L.latLng(coords[k][0], coords[k][1]));
      }
      if (leg.agencyId) {
        insts.push({
          type: "Transit",
          time: null,
          duration: null,
          text: `Board ${leg.agencyName} Route ${leg.routeShortName} (${leg.headsign}) at ${leg.from.name}`,
          index: 0
        });
        insts.push({
          type: "Transit",
          time: leg.duration,
          distance: leg.distance,
          text: `Ride from ${leg.from.name} to ${leg.to.name} (${leg.to.stopSequence - leg.from.stopSequence} stops, ${leg.duration} seconds)`,
          index: 0
        })
        insts.push({
          type: "Transit",
          time: null,
          duration: null,
          text: `Exit the vehicle at ${leg.to.name}`,
          index: 0
        })
      }
      var lastStep = 0;
      for (var j = 0; j < leg.steps.length; j++) {
        var inst = this._convertInstruction(leg.steps[j]);
        // index into shape
        for (var s = lastStep; s < coords.length; s++) {
          var d = ((coords[s][0] - inst.lat)**2 + (coords[s][1] - inst.lon)**2)**0.5;
          if (d < 0.00001) {
            inst.index = lastStep = s;
          } else {
            inst.index = lastStep;
          }
        }
        insts.push(inst);
      }
      return [coordinates, insts];
    },

    _convertInstruction: function (inst) {
      var type = (inst.relativeDirection || "").toLowerCase();
      switch (type) {
        case "depart":
          type = "StartAt";
          break;
        case "left":
          type = "Left";
          break;
        case "right":
          type = "Right";
          break;
        case "hard_right":
          type = "SharpRight";
          break;
        case "hard_left":
          type = "SharpLeft";
          break;
        default:
          type = "";
      }
      return {
        type: type,
        time: 0,
        distance: inst.distance,
        road: inst.streetName,
        direction: inst.absoluteDirection,
        lat: inst.lat,
        lon: inst.lon,
        index: 0 // relative to leg
      }
    }
  });
})();
