// Minimal built-in country-city dataset for selection
// Extend as needed; values include approximate lat/lng for cities
export const COUNTRIES = [
  {
    code: 'CN', name: 'China', cities: [
      { name: 'Beijing', lat: 39.9042, lng: 116.4074 },
      { name: 'Shanghai', lat: 31.2304, lng: 121.4737 },
      { name: 'Guangzhou', lat: 23.1291, lng: 113.2644 },
      { name: 'Shenzhen', lat: 22.5431, lng: 114.0579 },
      { name: 'Chengdu', lat: 30.5728, lng: 104.0668 }
    ]
  },
  {
    code: 'US', name: 'United States', cities: [
      { name: 'New York', lat: 40.7128, lng: -74.006 },
      { name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
      { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
      { name: 'Chicago', lat: 41.8781, lng: -87.6298 },
      { name: 'Seattle', lat: 47.6062, lng: -122.3321 }
    ]
  }
];
