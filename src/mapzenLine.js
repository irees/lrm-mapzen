(function() {
  'use strict';

  var L = require('leaflet');

  module.exports = L.LayerGroup.extend({
    // L.Evented is only present in Leaflet v1+
    // L.Mixin.Events is legacy; was deprecated in Leaflet v1 and started
    // logging deprecation warnings in console in v1.1
    includes: L.Evented ? L.Evented.prototype : L.Mixin.Events,

    options: {
      styles: [
        {color: 'white', opacity: 0.8, weight: 8},
        {color: '#06a6d4', opacity: 1, weight: 6}
      ],
      missingRouteStyles: [
        {color: 'black', opacity: 0.15, weight: 8},
        {color: 'white', opacity: 0.6, weight: 6},
        {color: 'gray', opacity: 0.8, weight: 4, dashArray: '7,12'}
      ],
      addWaypoints: true,
      extendToWaypoints: true,
      missingRouteTolerance: 10
    },

    initialize: function(route, options) {
      L.setOptions(this, options);
      L.LayerGroup.prototype.initialize.call(this, options);
      this._route = route;

      if (this.options.extendToWaypoints) {
        this._extendToWaypoints();
      }

      if (route.subRoutes) {
        for(var i = 0; i < route.subRoutes.length; i++) {
          if(!route.subRoutes[i].styles) route.subRoutes[i].styles = this.options.styles;
          console.log("subRoute", i, route.subRoutes[i]);
          this._addSegment(
            route.subRoutes[i].coordinates,
            route.subRoutes[i].styles,
            this.options.addWaypoints);
        }
      } else {
       this._addSegment(
        route.coordinates,
        this.options.styles,
        this.options.addWaypoints);
      }
    },

    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    getBounds: function() {
      return L.latLngBounds(this._route.coordinates);
    },

    _findWaypointIndices: function() {
      var wps = this._route.inputWaypoints,
          indices = [],
          i;
      for (i = 0; i < wps.length; i++) {
        indices.push(this._findClosestRoutePoint(wps[i].latLng));
      }

      return indices;
    },

    _findClosestRoutePoint: function(latlng) {
      var minDist = Number.MAX_VALUE,
        minIndex,
          i,
          d;

      for (i = this._route.coordinates.length - 1; i >= 0 ; i--) {
        // TODO: maybe do this in pixel space instead?
        d = latlng.distanceTo(this._route.coordinates[i]);
        if (d < minDist) {
          minIndex = i;
          minDist = d;
        }
      }

      return minIndex;
    },

    _extendToWaypoints: function() {
      var wps = this._route.inputWaypoints,
        wpIndices = this._getWaypointIndices(),
          i,
          wpLatLng,
          routeCoord;

      for (i = 0; i < wps.length; i++) {
        wpLatLng = wps[i].latLng;
        routeCoord = L.latLng(this._route.coordinates[wpIndices[i]]);
        if (wpLatLng.distanceTo(routeCoord) >
          this.options.missingRouteTolerance) {
          this._addSegment([wpLatLng, routeCoord],
            this.options.missingRouteStyles);
        }
      }
    },

    _addSegment: function(coords, styles, mouselistener) {
      var i,
        pl;
      for (i = 0; i < styles.length; i++) {
        pl = L.polyline(coords, styles[i]);
        this.addLayer(pl);
        if (mouselistener) {
          pl.on('mousedown', this._onLineTouched, this);
        }
      }
    },

    _findNearestWpBefore: function(i) {
      var wpIndices = this._getWaypointIndices(),
        j = wpIndices.length - 1;
      while (j >= 0 && wpIndices[j] > i) {
        j--;
      }

      return j;
    },

    _onLineTouched: function(e) {
      var afterIndex = this._findNearestWpBefore(this._findClosestRoutePoint(e.latlng));
      this.fire('linetouched', {
        afterIndex: afterIndex,
        latlng: e.latlng
      });
    },

    _getWaypointIndices: function() {
      if (!this._wpIndices) {
        this._wpIndices = this._route.waypointIndices || this._findWaypointIndices();
      }

      return this._wpIndices;
    }
  });

})();
