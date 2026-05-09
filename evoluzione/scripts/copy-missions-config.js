'use strict';
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public', 'js', 'missions-config.json');
const dest = path.join(__dirname, '..', 'functions', 'missions-config.json');
fs.copyFileSync(src, dest);
