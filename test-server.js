const express = require('express');
const app = express();

// Test basic route
app.get('/', (req, res) => {
  res.json({ message: 'Test server working' });
});

app.listen(5000, () => {
  console.log('Test server running on port 5000');
});