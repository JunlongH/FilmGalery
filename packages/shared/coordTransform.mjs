/**
 * WGS-84 ↔ GCJ-02 coordinate transformation
 *
 * GCJ-02 ("Mars coordinates") is the mandatory coordinate system for all
 * map services in China (Amap, Tencent Maps, etc.).  GPS receivers and
 * OpenStreetMap use WGS-84.  This module provides the standard non-linear
 * transformation between the two systems.
 *
 * Accuracy: < 1 m after transformation.
 */

const PI = Math.PI;
const A  = 6378245.0;          // Semi-major axis (Krasovsky 1940)
const EE = 0.00669342162296594; // Eccentricity squared

/**
 * Check whether a point is inside China (rough bounding box).
 * Points outside China do NOT need GCJ-02 transformation.
 */
function isInChina(lat, lng) {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y +
    0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x +
    0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02
 * @param {number} wgsLat - WGS-84 latitude
 * @param {number} wgsLng - WGS-84 longitude
 * @returns {{ lat: number, lng: number }} GCJ-02 coordinates
 */
function wgs84ToGcj02(wgsLat, wgsLng) {
  if (!isInChina(wgsLat, wgsLng)) return { lat: wgsLat, lng: wgsLng };

  let dLat = transformLat(wgsLng - 105.0, wgsLat - 35.0);
  let dLng = transformLng(wgsLng - 105.0, wgsLat - 35.0);
  const radLat = wgsLat / 180.0 * PI;
  let magic  = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: wgsLat + dLat, lng: wgsLng + dLng };
}

/**
 * GCJ-02 → WGS-84 (iterative, < 0.5 m accuracy)
 * @param {number} gcjLat - GCJ-02 latitude
 * @param {number} gcjLng - GCJ-02 longitude
 * @returns {{ lat: number, lng: number }} WGS-84 coordinates
 */
function gcj02ToWgs84(gcjLat, gcjLng) {
  if (!isInChina(gcjLat, gcjLng)) return { lat: gcjLat, lng: gcjLng };

  let wgsLat = gcjLat, wgsLng = gcjLng;
  for (let i = 0; i < 6; i++) {
    const gcj = wgs84ToGcj02(wgsLat, wgsLng);
    wgsLat += gcjLat - gcj.lat;
    wgsLng += gcjLng - gcj.lng;
  }
  return { lat: wgsLat, lng: wgsLng };
}

export {
  wgs84ToGcj02,
  gcj02ToWgs84,
  isInChina,
  transformLat,
  transformLng,
}