'use strict';

// Delegate entirely to the shared handler so logic lives in one place.
const { handleMessage } = require('../src/webhook');
module.exports = handleMessage;
