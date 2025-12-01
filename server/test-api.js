const http = require('http');

const req = http.get('http://127.0.0.1:4000/api/locations/countries', (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Body length:', data.length);
    try {
      const json = JSON.parse(data);
      console.log('Is Array:', Array.isArray(json));
      console.log('First item:', json[0]);
    } catch (e) {
      console.log('Body:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});
