import {
  LEAFLET_JS,
  LEAFLET_CSS,
  MARKERCLUSTER_JS,
  MARKERCLUSTER_CSS,
  MARKERCLUSTER_DEFAULT_CSS,
} from './leafletVendor';

export const getLeafletHtml = (
  initialRegion: any,
  mapProvider = 'osm',
  isDark = false,
  mode: 'view' | 'pick' = 'view',
  initialLatLng: [number, number] | null = null
) => {
  const isAmapDark = mapProvider === 'amap' && isDark;
  const tileLayerConfig = mapProvider === 'amap'
    ? {
        url: `'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'`,
        options: `{ maxZoom: 19, subdomains: ['1','2','3','4']${isAmapDark ? ", className: 'amap-dark-tile'" : ''} }`
      }
    : {
        url: `'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'`,
        options: `{ maxZoom: 20, subdomains: 'abcd' }`
      };

  const isPickMode = mode === 'pick';
  const pickMarkerInit = initialLatLng
    ? `const pickMarker = L.marker([${initialLatLng[0]}, ${initialLatLng[1]}], { draggable: true }).addTo(map);`
    : `let pickMarker = null;`;

  // In pick mode, map clicks move the marker and post a MAP_PICK message.
  // In view mode, the original photo-cluster behavior is preserved.
  const pickModeScript = `
        ${pickMarkerInit}

        map.on('click', function(e) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            if (pickMarker) {
                pickMarker.setLatLng([lat, lng]);
            } else {
                pickMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
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

        function sendMessage(type, payload) {
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
            }
        }

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
        #map { width: 100vw; height: 100vh; background-color: #f8f9fa; }
        .amap-dark-tile {
            filter: invert(1) hue-rotate(200deg) brightness(0.85) saturate(0.7);
        }

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
        const startZoom = ${isPickMode ? '13' : '5'};

        const map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([startLat, startLng], startZoom);

        L.tileLayer(${tileLayerConfig.url}, ${tileLayerConfig.options}).addTo(map);

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
