import {
  LEAFLET_JS,
  LEAFLET_CSS,
  MARKERCLUSTER_JS,
  MARKERCLUSTER_CSS,
  MARKERCLUSTER_DEFAULT_CSS,
} from './leafletVendor';
import { getTileLayerConfig } from '@filmgallery/shared/mapUtils';

/**
 * Serialize a shared tile-layer config into a Leaflet `L.tileLayer` options
 * object-literal string, merged with mobile perf defaults.
 *
 * Performance options (all real Leaflet GridLayer options):
 *  - fadeAnimation: false   — avoids an Android WebView repaint glitch and
 *    removes the per-tile fade that looks like lag on emulators.
 *  - updateWhenZooming: false / updateWhenIdle: true — only fetch tiles once
 *    zoom/pan settles (saves bandwidth on mobile networks).
 *  - keepBuffer: 2 — retain 2 layers of offscreen tiles for smoother panning.
 *
 * NOTE: Leaflet TileLayer has NO `cache` option; HTTP caching is handled by
 * the WebView. Do not add `cache: true` (no-op, misleading).
 */
function buildTileOptionsString(config: { maxZoom?: number; subdomains?: string[]; className?: string }): string {
  const parts: string[] = [];
  parts.push(`maxZoom: ${config.maxZoom ?? 19}`);
  if (config.subdomains) parts.push(`subdomains: ${JSON.stringify(config.subdomains)}`);
  if (config.className) parts.push(`className: ${JSON.stringify(config.className)}`);
  parts.push('fadeAnimation: false');
  parts.push('updateWhenZooming: false');
  parts.push('updateWhenIdle: true');
  parts.push('keepBuffer: 2');
  return `{ ${parts.join(', ')} }`;
}

// Inline-SVG divIcon for the pick marker. Leaflet's default marker loads
// marker-icon.png from a relative path that is unresolvable inside an inline
// HTML WebView (no base URL) → the icon silently fails to render. A divIcon
// with inline SVG has no external assets and always renders. Mirrors the
// desktop LocationPicker.jsx `pinIcon`.
const PICK_MARKER_ICON_DEF = `L.divIcon({
  className: 'fg-pick-marker',
  html: '<svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" fill="#ef4444" stroke="white" stroke-width="1.5"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
})`;

export const getLeafletHtml = (
  initialRegion: any,
  mapProvider: 'osm' | 'amap' = 'osm',
  isDark = false,
  mode: 'view' | 'pick' = 'view',
  initialLatLng: [number, number] | null = null
) => {
  // Single source of truth: consume the shared tile-layer config. Do NOT
  // hardcode provider URLs here — that was the drift v4 warned about for
  // PhotoMap.jsx. OSM dark → CartoDB Dark Matter; AMap dark → same road URL
  // + className 'amap-dark-tile' (CSS filter, since AMap has no native dark).
  const tileConfig = getTileLayerConfig(mapProvider, isDark ? 'dark' : 'light');
  const tileUrl = JSON.stringify(tileConfig.url);
  const tileOptions = buildTileOptionsString(tileConfig);

  const isPickMode = mode === 'pick';
  // Always declare pickMarker with `let`. Even when there is an initial
  // coordinate, the click handler's else-branch reassigns it; declaring
  // `const` when initial is set would throw TypeError on that assignment
  // if behavior ever changed.
  const pickMarkerInit = initialLatLng
    ? `let pickMarker = L.marker([${initialLatLng[0]}, ${initialLatLng[1]}], { draggable: true, icon: ${PICK_MARKER_ICON_DEF} }).addTo(map);`
    : `let pickMarker = null;`;

  // In pick mode, map clicks move the marker and post a MAP_PICK message,
  // and incoming CENTER_MAP messages (from the GPS button) pan the map and
  // marker. In view mode, the original photo-cluster behavior is preserved.
  const pickModeScript = `
        ${pickMarkerInit}

        function handleMessage(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'CENTER_MAP') {
                    const { lat, lng, zoom } = data.payload;
                    map.setView([lat, lng], zoom || 15, { animate: true });
                    if (pickMarker) {
                        pickMarker.setLatLng([lat, lng]);
                    } else {
                        pickMarker = L.marker([lat, lng], { draggable: true, icon: ${PICK_MARKER_ICON_DEF} }).addTo(map);
                    }
                }
            } catch (e) {
                console.error('pick handleMessage error', e);
            }
        }
        document.addEventListener('message', handleMessage);
        window.addEventListener('message', handleMessage);

        map.on('click', function(e) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            if (pickMarker) {
                pickMarker.setLatLng([lat, lng]);
            } else {
                pickMarker = L.marker([lat, lng], { draggable: true, icon: ${PICK_MARKER_ICON_DEF} }).addTo(map);
            }
            sendMessage('MAP_PICK', { lat, lng });
        });

        if (pickMarker) {
            pickMarker.on('dragend', function(e) {
                const ll = e.target.getLatLng();
                sendMessage('MAP_PICK', { lat: ll.lat, lng: ll.lng });
            });
        }

        sendMessage('MAP_READY', null);
    `;

  const viewModeScript = `
        // Marker Cluster Group
        let markers = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,

            iconCreateFunction: function (cluster) {
                const childMarkers = cluster.getAllChildMarkers();
                const count = childMarkers.length;
                let images = [];

                for (let i = 0; i < Math.min(4, count); i++) {
                    const props = childMarkers[i].options.photoData;
                    if (props && props.thumbUrl) {
                        images.push(props.thumbUrl);
                    }
                }

                const numImages = Math.min(images.length, 4);
                const layoutClass = 'layout-' + numImages;

                let html = '<div class="cluster-mosaic ' + layoutClass + '">';

                if (numImages === 1) {
                     html += '<div class="mosaic-item"><img src="' + images[0] + '" onerror="this.style.display=\\'none\\'"/></div>';
                } else if (numImages === 2) {
                     html += '<div class="mosaic-item"><img src="' + images[0] + '" onerror="this.style.display=\\'none\\'"/></div>';
                     html += '<div class="mosaic-item"><img src="' + images[1] + '" onerror="this.style.display=\\'none\\'"/></div>';
                } else if (numImages === 3) {
                     html += '<div class="mosaic-main"><img src="' + images[0] + '" onerror="this.style.display=\\'none\\'"/></div>';
                     html += '<div class="mosaic-col">';
                     html += '<div class="mosaic-sub"><img src="' + images[1] + '" onerror="this.style.display=\\'none\\'"/></div>';
                     html += '<div class="mosaic-sub"><img src="' + images[2] + '" onerror="this.style.display=\\'none\\'"/></div>';
                     html += '</div>';
                } else {
                     images.slice(0, 4).forEach((url) => {
                        html += '<div class="mosaic-item"><img src="' + url + '" onerror="this.style.display=\\'none\\'"/></div>';
                     });
                }

                if (count > 1) {
                    html += '<div class="cluster-count">' + count + ' photos</div>';
                }

                html += '</div>';

                return L.divIcon({
                    html: html,
                    className: '',
                    iconSize: [68, 68],
                    iconAnchor: [34, 34]
                });
            }
        });

        map.addLayer(markers);

        document.addEventListener('message', handleMessage);
        window.addEventListener('message', handleMessage);

        function handleMessage(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'UPDATE_PHOTOS') {
                    updateMarkers(data.payload);
                } else if (data.type === 'CENTER_MAP') {
                    const { lat, lng, zoom } = data.payload;
                    map.setView([lat, lng], zoom || 15, { animate: true });
                }
            } catch (e) {
                console.error('Error parsing message', e);
            }
        }

        function updateMarkers(photos) {
            markers.clearLayers();

            const newMarkers = photos.map((photo) => {
                const lat = parseFloat(photo.latitude);
                const lng = parseFloat(photo.longitude);
                if (isNaN(lat) || isNaN(lng)) return null;

                const iconHtml = \`
                    <div class="custom-marker" style="width: 56px; height: 56px;">
                        <img src="\${photo.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover;object-position:center center;display:block;" />
                    </div>
                \`;

                const icon = L.divIcon({
                    html: iconHtml,
                    className: '',
                    iconSize: [56, 56],
                    iconAnchor: [28, 28]
                });

                const marker = L.marker([lat, lng], {
                    icon: icon,
                    photoData: {
                        id: photo.id,
                        thumbUrl: photo.thumbnailUrl
                    }
                });

                marker.on('click', () => {
                   sendMessage('MARKER_PRESS', photo);
                });

                return marker;
            }).filter((m) => m !== null);

            markers.addLayers(newMarkers);
        }

        sendMessage('MAP_READY', null);
    `;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <style>${LEAFLET_CSS}</style>
    <style>${MARKERCLUSTER_CSS}</style>
    <style>${MARKERCLUSTER_DEFAULT_CSS}</style>
    <style>
        body { margin: 0; padding: 0; }
        #map { width: 100vw; height: 100vh; background-color: ${isDark ? '#1a1a1a' : '#f8f9fa'}; }
        .amap-dark-tile {
            filter: invert(1) hue-rotate(200deg) brightness(0.85) saturate(0.7);
        }
        .fg-pick-marker { background: transparent; border: none; }

        .custom-marker {
            border-radius: 12px;
            overflow: hidden;
            border: 2px solid white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            background: #fff;
            transition: transform 0.2s ease;
        }
        .custom-marker:active {
            transform: scale(1.1);
        }
        .custom-marker img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: center;
            display: block;
        }

        .cluster-mosaic {
            width: 68px;
            height: 68px;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 6px 16px rgba(0,0,0,0.25);
            overflow: hidden;
            border: 2px solid white;
            position: relative;
            box-sizing: border-box;
            display: flex;
        }

        .layout-1 .mosaic-item { width: 100%; height: 100%; }
        .layout-2 { flex-direction: row; }
        .layout-2 .mosaic-item { width: 50%; height: 100%; border-right: 1px solid white; box-sizing: border-box; }
        .layout-2 .mosaic-item:last-child { border-right: none; }
        .layout-2 .mosaic-item img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
        .layout-3 { flex-direction: row; }
        .layout-3 .mosaic-main { width: 50%; height: 100%; border-right: 1px solid white; box-sizing: border-box; }
        .layout-3 .mosaic-col { width: 50%; height: 100%; display: flex; flex-direction: column; }
        .layout-3 .mosaic-sub { width: 100%; height: 50%; border-bottom: 1px solid white; box-sizing: border-box; }
        .layout-3 .mosaic-sub:last-child { border-bottom: none; }
        .layout-3 img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
        .layout-4 { flex-wrap: wrap; }
        .layout-4 .mosaic-item {
            width: 50%;
            height: 50%;
            box-sizing: border-box;
            border-right: 1px solid white;
            border-bottom: 1px solid white;
        }
        .layout-4 .mosaic-item:nth-child(2n) { border-right: none; }
        .layout-4 .mosaic-item:nth-child(3), .layout-4 .mosaic-item:nth-child(4) { border-bottom: none; }
        .layout-4 .mosaic-item img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }

        .cluster-count {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.55));
            color: white;
            border-radius: 0 0 14px 14px;
            padding: 12px 6px 4px 6px;
            font-size: 11px;
            font-weight: 600;
            z-index: 10;
            text-align: center;
            letter-spacing: 0.3px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
    </style>
</head>
<body>
    <div id="map"></div>

    <script>${LEAFLET_JS}</script>
    ${isPickMode ? '' : `<script>${MARKERCLUSTER_JS}</script>`}

    <script>
        const startLat = ${initialRegion.latitude || 31.2304};
        const startLng = ${initialRegion.longitude || 121.4737};
        const startZoom = ${isPickMode ? (initialLatLng ? '13' : '11') : '5'};

        const map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([startLat, startLng], startZoom);

        L.tileLayer(${tileUrl}, ${tileOptions}).addTo(map);

        function sendMessage(type, payload) {
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
            }
        }

        ${isPickMode ? pickModeScript : viewModeScript}

    </script>
</body>
</html>
`;
};
