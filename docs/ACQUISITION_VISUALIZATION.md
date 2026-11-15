# Acquisition visualization and timeline synchronization

## Display modes

The Sentinel-1 and NISAR acquisition layers expose two modes:

- **Footprints** draws the catalogued acquisition geometry (low-opacity fill and a thin mission-coloured edge).
- **Density** rasterizes the same geometries into a single world texture per mission. Overlapping scenes add brightness and edges are softened. This is acquisition coverage density, not radar backscatter or flood intensity.

Each mission uses two canvas textures and two Cesium rectangle entities rather than thousands of billboard entities. Original normalized footprint rings remain in memory for geographic hover picking and metadata display.

## Timeline behavior

The timeline controls a trailing UTC interval. The `Show data from last` selector defines its width; the selected timeline time is the interval end. When a user scrubs, changes the date/time, steps, or changes the interval, the app waits 450 ms for the interaction to settle and then queries the ASF DAAC Search API for the selected missions and current map extent. A newer search aborts an older in-flight request.

During animated playback, searches are held until playback is paused to avoid sending a network request on every animation frame. The final paused time is searched automatically. The camera is not moved when timeline searches complete.

ASF response latency and availability depend on the network and upstream catalogue. The app shows `SEARCHING ASF` while a request is in progress and reports the returned acquisition count when complete.

## Hover behavior

Hover matching uses the original polygon rings, with cached bounding boxes as a fast prefilter. The density texture is only a display aggregation; it does not replace or alter the source footprint geometry.
